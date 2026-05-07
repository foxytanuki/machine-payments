**Early preview** — sandbox only. Production rails open soon.

# HitPayMPP

Machine Payment Protocol.

One-line middleware for charging HTTP endpoints via `402 Payment Required`.
Settles via your existing [HitPay](https://www.hitpayapp.com/) account — PayNow, DuitNow, e-wallets, or any supported rail.


```
npm i @hit-pay/mpp@beta
```

Copy

## What is MPP?

The [Machine Payment Protocol](https://mpp.dev/)
is a payment flow built on standard HTTP. Servers respond with
`402 Payment Required` plus a `WWW-Authenticate: Payment`
challenge. Clients fetch the payment, retry the request with a credential, and
receive a cryptographically signed receipt.


The spec defines pluggable _methods_. HitPay MPP implements two:
`method="hitpay"` for one-time payments, and
`method="hitpay-save"` for save-payment-method (a Stripe-SPT
analog — the agent gets a signed grant and reuses it across requests).


## What runs where?

Four pieces. You install two of them; we operate the service; HitPay core moves the money.

```
  YOUR SERVER              AGENT RUNTIME          WE HOST               HITPAY APIs
  ───────────              ─────────────          ─────────              ────────────
  @hit-pay/mpp             @hit-pay/mpp-client    mpp.hitpay.dev         api.hit-pay.com
  wraps your handler       handles 402 / polls    brokers charges        settles money
  emits 402 challenges     retries with cred.     signs receipts         fires webhooks
                           verifies receipts      publishes JWKS         (no new setup)
```

`@hit-pay/mpp`your server

Wraps any fetch-style handler (`(Request, ctx) => Response`) with
`402` gating. Works directly in Next.js App Router and any framework
using standard `Request`/`Response`. Adapters for Express
and Fastify come later.


`@hit-pay/mpp-client`agent runtime

Detects `402` responses, surfaces the checkout URL to the user (or
auto-pays under a cap), polls the broker until the charge settles, retries
with an `Authorization: Payment` credential, and verifies the
returned JWS receipt against the broker's JWKS.


`mpp.hitpay.dev`we host

Stateless broker. Creates HitPay `payment_requests` using the API
key your SDK passes through. Receives HitPay webhooks, flips charge status,
signs Ed25519 JWS receipts. You don't deploy or operate it. Sandbox:
[sandbox.mpp.hitpay.dev](https://sandbox.mpp.hitpay.dev/).


`HitPay APIs`your account

Where money actually moves. Same rails as your existing HitPay checkout — no
new account, no enablement toggle. MPP charges show up tagged
`source=mpp` in your usual transaction list.


## What works today?

Shipping

- Sandbox end-to-end: 402 → HitPay checkout → webhook → JWS receipt
- `@hit-pay/mpp` server SDK on npm under `@beta`
- `@hit-pay/mpp-client` agent SDK on npm under `@beta`
- Saved payment methods (embedded direct-link · GrabPay / ShopeePay / Touch'n'Go)
- Ed25519 JWS receipts + SPM grants · public JWKS · per-merchant HMAC webhooks
- Nonce-unique charges · request-hash binding against replay

Soon

- Production rails (live keys, `mpp.hitpay.dev` prod endpoint)
- Express / Fastify adapters
- `npx @hit-pay/mpp test <url>` local dev CLI
- Structured multi-rail challenges (PayNow QR payload, etc.)
- KMS-backed signing keys · audit log · rate limits

## How does it work?

Two methods, same protocol shape. **One-time payment** charges the agent for a single request. **Save payment method** mints a signed grant the agent stores and presents on future requests — no checkout round-trip per call.

One-time paymentSave payment method

Agent pays once per request. `method="hitpay"`.

```
  Agent               Your server            mpp.hitpay.dev
    │                      │                         │
    │  GET /data           │                         │
    │─────────────────────▶│                         │
    │                      │  POST /v1/charges       │
    │                      │────────────────────────▶│
    │                      │  {challenge_id, url}    │
    │                      │◀────────────────────────│
    │  402 + challenge    │                         │
    │◀─────────────────────│                         │
    │                                                │
    │  (agent surfaces checkout_url; broker          │
    │   observes payment completion)                 │
    │                                                │
    │  GET /v1/charges/:id  (polls until paid)       │
    │───────────────────────────────────────────────▶│
    │                                                │
    │  retry + Authorization: Payment <credential>   │
    │─────────────────────▶│                         │
    │                      │  POST /v1/charges/:id/verify
    │                      │────────────────────────▶│
    │                      │  { receipt_jws }        │
    │                      │◀────────────────────────│
    │  200 + data + Payment-Receipt: <jws>         │
    │◀─────────────────────│                         │
```

- **Pass-through auth.** Your HitPay API key is never persisted by the broker.
- **Nonce-unique charges.** Per-merchant `UNIQUE(merchant_id, nonce)` prevents replay.
- **Request-hash binding.** A credential minted for `/forecast?zip=94103` can't be replayed against `/forecast?zip=10001`.
- **Signed receipts.** Ed25519 JWS. Verify locally against
[`/.well-known/jwks.json`](https://mpp.hitpay.dev/.well-known/jwks.json).

Agent saves a wallet once, then charges against it without re-authorizing. `method="hitpay-save"`. Embedded direct-link only — GrabPay, ShopeePay, Touch'n'Go.

```
  Agent               Your server            mpp.hitpay.dev            Wallet
    │                      │                         │                     │
    │ ── Setup (one-time) ─────────────────────────────────────────────── │
    │                      │                         │                     │
    │  GET /data           │                         │                     │
    │  + rail pick         │                         │                     │
    │─────────────────────▶│                         │                     │
    │                      │  POST /v1/saved-payment-methods               │
    │                      │  payment_method=grabpay │                     │
    │                      │────────────────────────▶│                     │
    │                      │  {setup_checkout_url}   │                     │
    │                      │◀────────────────────────│                     │
    │  402 + setup URL     │                         │                     │
    │◀─────────────────────│                         │                     │
    │                                                                      │
    │  open setup URL — user approves in wallet                            │
    │─────────────────────────────────────────────────────────────────────▶│
    │                                                │ webhook: attached   │
    │                                                │◀────────────────────│
    │                                                │ (sign SPM JWS)      │
    │                                                                      │
    │  GET /v1/saved-payment-methods/:id  (polls until active)             │
    │───────────────────────────────────────────────▶│                     │
    │  {status: active, saved_method_jws}            │                     │
    │◀───────────────────────────────────────────────│                     │
    │                                                                      │
    │ ── Charge (any number of times, same SPM JWS) ────────────────────── │
    │                                                                      │
    │  GET /data                                                           │
    │  Authorization: Payment <spm_jws>               │                    │
    │─────────────────────▶│                         │                     │
    │                      │  POST /v1/saved-payment-methods/:id/charges   │
    │                      │────────────────────────▶│                     │
    │                      │                         │ charge wallet       │
    │                      │                         │────────────────────▶│
    │                      │                         │ succeeded           │
    │                      │                         │◀────────────────────│
    │                      │  {receipt_jws}          │                     │
    │                      │◀────────────────────────│                     │
    │  200 + Payment-Receipt: <jws>                                    │
    │◀─────────────────────│                                               │
```

- **Signed grant.** Saved-method credential is an Ed25519 JWS (`typ: mpp-spm+jwt`) — distinct from receipts so it can't be confused with one.
- **Scope baked in.** Per-charge cap, total cap, expiry, usage count, currency — all in the JWS claims. Merchant can verify offline before charging.
- **Defense-in-depth.** Broker re-checks every claim on the charge call; HitPay's recurring-billing id never moves money beyond the SPM's scope.
- **Embedded only.** Setup deep-links into GrabPay / ShopeePay / Touch'n'Go. No card flow, no hosted multi-rail picker.

## How do I use it?

Next.js App Router shown below. The core package works directly — no adapter needed.

1

### Install

```
npm i @hit-pay/mpp@beta
```

2

### Get sandbox credentials

From the [HitPay sandbox dashboard](https://dashboard.sandbox.hit-pay.com/):

- **Developers → API Keys** — copy your `test_...` API key.
- **Developers → Webhook Endpoints → Add webhook** — URL
`https://sandbox.mpp.hitpay.dev/v1/webhook/hitpay`. For one-time charges subscribe to `payment_request.completed`; for saved methods also subscribe to `recurring_billing.method_attached`, `recurring_billing.method_detached`, and `charge.created`. Copy the endpoint's signing salt.

3

### Initialize the SDK

```
import { createMpp } from '@hit-pay/mpp'

const mpp = createMpp({
  apiKey: process.env.HITPAY_API_KEY!,
  webhookSalt: process.env.HITPAY_WEBHOOK_SALT,
  endpoint: 'https://sandbox.mpp.hitpay.dev',
})
```

4

### Protect your handler

Pick the variant for what you want to charge for. Both wrap the same handler signature.

#### hitpay One-time payment

```
import { NextResponse } from 'next/server'

// app/api/forecast/[zip]/route.ts
export const GET = mpp.protect(
  { amount: '1.00', currency: 'sgd', description: 'Forecast' },
  async (_req, ctx) => {
    const { zip } = await ctx.params
    return NextResponse.json({ zip, forecast: 'sunny' })
  },
)
```

No credential → `402` with a HitPay checkout URL. Credential present → broker verifies the charge, signs a receipt JWS, your handler runs.

#### hitpay-save Save payment method

```
export const GET = mpp.protectSavedMethod(
  {
    customerEmail: (req) => req.headers.get('x-user-email')!,
    currency: 'sgd',
    maxAmountPerCharge: '5.00',
    totalAmountCap: '50.00',
    perCallAmount: '0.50',
  },
  async (_req, ctx) => {
    const { zip } = await ctx.params
    return NextResponse.json({ zip, forecast: 'sunny' })
  },
)
```

No SPM credential → `402` with a setup URL bound to the agent's chosen wallet. SPM JWS present → broker verifies the grant offline (signature + scope + expiry), charges the saved wallet, signs a receipt, your handler runs.

5

### From the agent

#### hitpay Pay each request

```
import { mppFetch } from '@hit-pay/mpp-client'

const { response, receipt } = await mppFetch(url, {
  onChallenge: (ch) => {
    // Surface the checkout URL to the user (or auto-approve under a cap)
    console.log('pay here:', ch.methodDetails.checkout_url)
    return { pay: true }
  },
})
```

#### hitpay-save Save once, reuse the JWS

```
import { mppSaveMethod, mppFetch } from '@hit-pay/mpp-client'

// One-time setup — let the user pick a wallet, open the deep link.
const rail = await ui.pickRail(['grabpay_direct', 'shopee_pay', 'touch_n_go'])
const spm = await mppSaveMethod(url, {
  paymentMethod: rail,
  customerEmail: 'alice@example.com',
  onSetupUrl: (u) => window.open(u),
})
saveToDisk(spm.jws)

// Reuse — present the JWS on any future charge to the same merchant.
const { response, receipt } = await mppFetch(url, {
  savedMethodJws: loadFromDisk(),
})
```

Each charge is bound to the request hash and counted against the SPM's per-charge and total caps. Receipt JWS verifies against [`/.well-known/jwks.json`](https://mpp.hitpay.dev/.well-known/jwks.json) like one-time receipts.

## Which endpoints does the broker expose?

These are the endpoints on `mpp.hitpay.dev` (and `sandbox.mpp.hitpay.dev`). You won't call them directly — the SDKs do.

| Method | Path | For | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/charges` | hitpay | Create a one-time charge bound to an MPP nonce. |
| GET | `/v1/charges/:id` | hitpay | Poll status (pending / paid / expired). |
| POST | `/v1/charges/:id/verify` | hitpay | Verify the charge was paid; return JWS receipt. |
| GET | `/v1/saved-payment-methods/options` | hitpay-save | Discover wallet rails available for a currency. |
| POST | `/v1/saved-payment-methods` | hitpay-save | Create a saved-method setup session for a picked rail. |
| GET | `/v1/saved-payment-methods/:id` | hitpay-save | Poll status (pending / active / detached); fetch SPM JWS once active. |
| POST | `/v1/saved-payment-methods/:id/charges` | hitpay-save | Charge the saved method; scope-checked; returns receipt JWS. |
| POST | `/v1/webhook/hitpay` | both | Inbound HitPay webhook (one-time + recurring lifecycle). |
| GET | `/.well-known/jwks.json` | both | Public signing keys for receipt + SPM-grant verification. |

## Where's the spec?

`draft-hitpay-charge-00` — challenge body shape, credential payload,
JWS receipt claims, canonical request-hash algorithm.


`draft-hitpay-saved-method-00` — saved-method setup challenge,
SPM JWS claims (typ `mpp-spm+jwt`), scope semantics, charge credential.


Source links land when the repo goes public.
