# MPP payments

Use MPP for machine-to-machine payments.

[MPP, the Machine Payments Protocol](https://mpp.dev), is a protocol for internet payments. When a client requests a paid resource, your server returns an HTTP `402` response with payment details. The client authorizes the payment, retries the request, pays, and gets access to the paid resource along with a receipt.

MPP supports two payment methods:

- **Crypto payments**: Direct on-chain payment that uses crypto deposit addresses. Available to businesses with a US legal entity in all states except New York and Texas.
- **Fiat payments**: Card, wallet, and other payment methods that [shared payment tokens (SPTs)](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md) support. Available to businesses with a US legal entity.

You can find the app’s [complete source code](https://github.com/stripe-samples/machine-payments) on GitHub.

## Before you begin

Machine payments must be enabled for your account.

> Your customers can use stablecoins as payment globally, but only US businesses can accept stablecoin payments.

To start accepting stablecoin payments:

1. Make sure you’ve [set up your Stripe account](https://docs.stripe.com/get-started/account/set-up.md).
1. Go to your [Payment methods](https://dashboard.stripe.com/settings/payment_methods) settings in the Dashboard and request the **Stablecoins and Crypto** payment method. If you only want to accept stablecoin or crypto payments for [machine payments](https://docs.stripe.com/payments/machine.md), we recommend creating a separate [payment method configuration](https://docs.stripe.com/payments/payment-method-configurations.md) dedicated to machine payments.
1. Stripe reviews your access request and contact you for more details if necessary. The payment method appears as **Pending** while we review your request.
1. After we approve your request, **Stablecoins and Crypto** becomes active in the Dashboard.

## Payment lifecycle

In this guide, you build the server. Your server indicates that payment is required and returns the content after successful payment.

#### Crypto
A diagram showing the MPP crypto payment flow between client, server, and Stripe (See full diagram at https://docs.stripe.com/payments/machine/mpp)
With crypto payments, Stripe handles deposit addresses and automatically *captures* (Another way to say that you receive payment for a charge is to say that you "capture" the charge. Capturing the charge is often asynchronous and takes place after authorization. The capture is what transfers the money from the customer to you) the [PaymentIntent](https://docs.stripe.com/api/payment_intents.md) when funds settle on-chain.

#### SPT
A diagram showing the MPP SPT payment flow between client, server, and Stripe (See full diagram at https://docs.stripe.com/payments/machine/mpp)
With [shared payment token payments (SPTs)](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md), the client creates an SPT, and the server creates a `PaymentIntent` with the token. Settlement completes through Stripe’s payment rails.

## When to use each method

| Method     | Best For                                                                    | Settlement             |
| ---------- | --------------------------------------------------------------------------- | ---------------------- |
| **Crypto** | Low dollar-value transactions                                               | On-chain settlement    |
| **SPT**    | Traditional payment methods, cards, wallets, broader payment method support | Stripe’s payment rails |

## Create your endpoint

Add payment middleware to your endpoint to require payment.

#### Crypto

This example requires 0.01 USD, paid in [pathUSD](https://docs.tempo.xyz/protocol/exchange/quote-tokens#pathusd), per request using the `tempo.charge` method.

#### Node.js

```node
import crypto from 'crypto';
import { Mppx, tempo } from 'mppx/server'

const PATH_USD = '0x20c0000000000000000000000000000000000000';

const mppSecretKey = crypto.randomBytes(32).toString('base64');

export async function handler(request: Request) {
  const recipientAddress = await createPayToAddress(request);

  const mppx = Mppx.create({
    methods: [
      tempo.charge({
        currency: PATH_USD,
        recipient: recipientAddress,
        testnet: true,
      }),
    ],
    secretKey: mppSecretKey,
  });

  const response = await mppx.charge({
    amount: '0.01',
    decimals: 6,
    recipient: recipientAddress,
  })(request);

  if (response.status === 402) return response.challenge;

  return response.withReceipt(Response.json({ data: '...' }));
}
```

#### SPT

This example requires 1 USD using the `stripe.charge` method with SPTs. The method handles challenge generation, credential verification, `PaymentIntent` creation, and receipt generation.

#### Node.js

```node
import crypto from 'crypto';
import { Mppx, stripe } from 'mppx/server'

// Secret used to secure payment challenges
// https://mpp.dev/protocol/challenges#challenge-binding
const mppSecretKey = crypto.randomBytes(32).toString('base64');

const mppx = Mppx.create({
  methods: [
    stripe.charge({
      networkId: 'internal',
      paymentMethodTypes: ['card', 'link'],
      secretKey: process.env.STRIPE_SECRET_KEY!,
    }),
  ],
  secretKey: mppSecretKey
});

export async function handler(request: Request) {
  const result = await mppx.charge({
    amount: '1',
    currency: 'usd',
    decimals: 2,
    description: 'Premium API access',
  })(request);

  if (result.status === 402) return result.challenge;

  return result.withReceipt(Response.json({ data: '...' }));
}
```

## Create a PaymentIntent

#### Crypto

To process crypto payments, create a [PaymentIntent](https://docs.stripe.com/api/payment_intents.md) that accepts the `crypto` *payment method* (PaymentMethods represent your customer's payment instruments, used with the Payment Intents or Setup Intents APIs). Use the `recipient` method from earlier.

> #### API version
> 
> This feature requires the `2026-03-04.preview` API version. Set the `Stripe-Version` header to `2026-03-04.preview` when initializing your Stripe client.

#### Node.js

```node
import Stripe from 'stripe';
import { Credential } from 'mppx';
import NodeCache from 'node-cache';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-03-04.preview',
});

// In-memory cache for deposit addresses (TTL: 5 minutes)
// NOTE: For production, use a distributed cache like Redis instead of node-cache
const paymentCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

async function createPayToAddress(request: Request): Promise<`0x${string}`> {
  const authHeader = request.headers.get('authorization');
  if (authHeader && Credential.extractPaymentScheme(authHeader)) {
    const credential = Credential.fromRequest(request);
    const toAddress = credential.challenge.request.recipient as `0x${string}`;

    if (!toAddress) {
      throw new Error(
        'PaymentIntent did not return expected crypto deposit details'
      );
    }
    if (!paymentCache.has(toAddress)) {
      throw new Error('Invalid payTo address: not found in server cache');
    }
    return toAddress;
  }

  const decimals = 6;
  const amountInCents = Number(10000) / 10 ** (decimals - 2);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountInCents,
    currency: 'usd',
    payment_method_types: ['crypto'],
    payment_method_data: {
      type: 'crypto',
    },
    payment_method_options: {
      crypto: {
        mode: 'deposit',
        deposit_options: {
          networks: ['tempo'],
        },
      } as Stripe.PaymentIntentCreateParams.PaymentMethodOptions.Crypto,
    },
    confirm: true,
  });

  if (
    !paymentIntent.next_action ||
    !('crypto_display_details' in paymentIntent.next_action)
  ) {
    throw new Error(
      'PaymentIntent did not return expected crypto deposit details'
    );
  }

  const depositDetails = paymentIntent.next_action
    .crypto_display_details as unknown as {
    deposit_addresses?: Record<string, { address?: string }>;
  };
  const payToAddress = depositDetails.deposit_addresses?.tempo?.address;

  if (!payToAddress) {
    throw new Error(
      'PaymentIntent did not return expected crypto deposit details'
    );
  }

  console.log(
    `Created PaymentIntent ${paymentIntent.id} for $${(
      amountInCents / 100
    ).toFixed(2)} -> ${payToAddress}`
  );

  paymentCache.set(payToAddress, true);
  return payToAddress as `0x${string}`;
}
```

This function returns a crypto deposit address that the client receives and uses for payment.

The [PaymentIntent](https://docs.stripe.com/api/payment_intents/object.md) response includes deposit addresses with `supported_tokens`, which lists the accepted tokens and their contract addresses for each network:

```json
{
  "id": "pi_123",
  "amount": 5000,
  "currency": "usd",
  "status": "requires_action",
  "next_action": {
    "type": "crypto_display_details",
    "crypto_display_details": {
      "deposit_addresses": {
        "tempo": {
          "address": "0xtempo_address",
          "supported_tokens": [
            {
              "token_currency": "usdc",
              "token_contract_address": "0x…"
            }
          ]
        }
      }
    }
  }
}
```

> #### Crypto PaymentIntents
> 
> For more details on how crypto PaymentIntents work, including deposit addresses, payment lifecycle, and supported networks, see the [deposit mode integration guide](https://docs.stripe.com/payments/deposit-mode-stablecoin-payments.md).

#### SPT

With SPT payments, the server automatically creates the PaymentIntent when it receives a valid SPT credential from the client. The `stripe.charge` method handles the PaymentIntent creation using the SPT provided by the client.

The PaymentIntent includes:

- The amount and currency from the challenge
- The payment method from the SPT
- Any metadata configured in the `stripe.charge` method
- Settlement through Stripe’s payment rails

You don’t need to create the PaymentIntent separately. `stripe.charge` creates it when it validates the credential.

## Test your endpoint

Your endpoint is ready to accept machine payments backed by Stripe. Verify that your integration works by making a request without a payment credential—your server must respond with a `402` status code and the payment requirements.

```bash
curl http://localhost:4242/paid | jq
```

You see a `402` status code with payment details.

```json
{
  "type": "https://paymentauth.org/problems/payment-required",
  "title": "Payment Required",
  "status": 402,
  "detail": "Payment is required.",
  "challengeId": "..."
}
```

Simulate a request with valid payment.

#### Crypto

Use [mppx](https://www.npmjs.com/package/mppx) to test in the command line.

```bash
npx mppx account create
npx mppx account fund
npx mppx http://localhost:4242/paid
```

> #### Sandboxes and testnet
> 
> [PaymentIntents](https://docs.stripe.com/api/payment_intents/object.md) that you create in a [sandbox](https://docs.stripe.com/sandboxes.md) don’t monitor crypto testnets, so we can’t automatically detect testnet transactions that you send. To test sandbox `PaymentIntents`, use the [test helper endpoint](https://docs.stripe.com/api/payment_intents/simulate_crypto_deposit.md?api-version=2026-03-04.preview) to simulate crypto deposits. [Learn more about testing your integration](https://docs.stripe.com/payments/deposit-mode-stablecoin-payments.md#test-your-integration).

If you connected a wallet, the server returns the content and you can confirm payment. In the [Stripe Dashboard](https://dashboard.stripe.com), go to **Payments** to see the transaction.

#### SPT

To test your integration in a [sandbox](https://docs.stripe.com/sandboxes.md), set your Stripe profile. [Create a Stripe profile](https://docs.stripe.com/get-started/account/profile.md) for your account, and use its `profile_test_` ID as the `networkId`. Use a test secret key to create test payments.

#### Node.js

```node
const mppx = Mppx.create({
  methods: [
    stripe.charge({
      networkId: 'profile_test_...',
      paymentMethodTypes: ['card', 'link'],
      secretKey: process.env.STRIPE_SANDBOX_SECRET_KEY!,
    }),
  ],
  secretKey: mppSecretKey
});
```

Use the [link-cli](https://link.com/agents) to issue a test SPT for your account. The `link-cli` is a tool that can provision one-time shared payment token credentials using your Link account. Follow the instructions at [link.com/agents](https://link.com/agents) to install the `link-cli` skills or register it as an MCP server in your preferred agent.

To test with the `link-cli` manually, you can directly invoke its commands:

1. Log in to your personal Link account, or [sign up](https://app.link.com) if you don’t have one.

```bash
npx @stripe/link-cli auth login
```

1. Choose the payment method you want to use. If you don’t already have one, [add a payment method](https://app.link.com/wallet).

```bash
npx @stripe/link-cli payment-methods list
```

1. Create a test spend request to issue a one-time test SPT. Pass `--test` to create test credentials and `--network-id` with your test `profile_test_` ID.

```bash
npx @stripe/link-cli spend-request create \
  --payment-method-id csmrpd_xxx \
  --context "Test machine payments integration with Shared Payment Tokens, your test Stripe profile, and the link-cli" \
  --amount 100 \
  --credential-type shared_payment_token \
  --network-id profile_test_... \
  --test \
  --request-approval
```

1. Run the payment. The `--method` and `--data` flags depend on your integration shape.

```bash
npx @stripe/link-cli mpp pay https://your-endpoint.com/resource \
  --spend-request-id lsrq_xxx \
  --method POST \
  --data '{ ... }'
```

In the [Stripe Dashboard](https://dashboard.stripe.com), go to **Payments** to see the transaction.

## Run mainnet and live mode transactions

#### Crypto

To run mainnet transactions, target USDC on Tempo at `0x20c000000000000000000000b9537d11c60e8b50` and remove `testnet: true` when you call `tempo.charge`.

#### Node.js

```node
import crypto from 'crypto';
import { Mppx, tempo } from 'mppx/server'

const TEMPO_USD = '0x20c000000000000000000000b9537d11c60e8b50';

const mppSecretKey = crypto.randomBytes(32).toString('base64');

export async function handler(request: Request) {
  const recipientAddress = await createPayToAddress(request);

  const mppx = Mppx.create({
    methods: [
      tempo.charge({
        currency: TEMPO_USD,
        recipient: recipientAddress
      }),
    ],
    secretKey: mppSecretKey,
  });
  ...
}
```

#### SPT

After you test your integration, [create your Stripe profile in live mode](https://docs.stripe.com/get-started/account/profile.md) and update the `profile_` ID accordingly. Switch to your production Stripe secret key in the MPP configuration. This lets clients target your `profile_` ID in live mode when they create an SPT.

#### Node.js

```node
const mppx = Mppx.create({
  methods: [
    stripe.charge({
      networkId: 'profile_...',
      paymentMethodTypes: ['card', 'link'],
      secretKey: process.env.STRIPE_SECRET_KEY!,
    }),
  ],
  secretKey: mppSecretKey
});
```

After you update your `profile_` ID, create a new spend request without the `--test` flag to issue a live mode SPT:

```bash
npx @stripe/link-cli spend-request create \
  --payment-method-id csmrpd_xxx \
  --context "Use machine payments integration with Shared Payment Tokens in live mode, your live Stripe profile, and the link-cli" \
  --amount 100 \
  --credential-type shared_payment_token \
  --network-id profile_... \
  --request-approval
```

Then re-run the `mpp pay` command against your live endpoint:

```bash
npx @stripe/link-cli mpp pay https://your-endpoint.com/resource \
  --spend-request-id lsrq_xxx \
  --method POST \
  --data '{ ... }'
```
