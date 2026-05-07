import crypto from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Credential } from "mppx";
import { Mppx, stripe, tempo } from "mppx/server";
import NodeCache from "node-cache";
import Stripe from "stripe";

const app = new Hono();

// Don't put any keys in code. Use an environment variable (as shown
// here) or secrets vault to supply keys to your integration.
//
// See https://docs.stripe.com/keys-best-practices and find your
// keys at https://dashboard.stripe.com/apikeys.
// Stripe handles payment processing and provides the crypto deposit address.
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY environment variable is required");
  process.exit(1);
}

const PATH_USD = "0x20c0000000000000000000000000000000000000";
const PRICE_USD = "1";
const PRICE_DECIMALS = 6;
const stripeNetworkId = process.env.STRIPE_NETWORK_ID || "internal";

// Secret used to secure payment challenges
// https://mpp.dev/protocol/challenges#challenge-binding
const mppSecretKey = crypto.randomBytes(32).toString("base64");

const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  // @ts-expect-error
  apiVersion: "2026-03-04.preview",
  appInfo: {
    name: "stripe-samples/machine-payments",
    url: "https://github.com/stripe-samples/machine-payments",
    version: "1.0.0",
  },
});

// In-memory cache for deposit addresses (TTL: 5 minutes)
// NOTE: For production, use a distributed cache like Redis instead of node-cache
const paymentCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

async function createPayToAddress(request: Request): Promise<`0x${string}`> {
  // If a payment header exists, extract the recipient from the credential
  const authHeader = request.headers.get("authorization");
  if (authHeader && Credential.extractPaymentScheme(authHeader)) {
    const credential = Credential.fromRequest(request);
    const toAddress = credential.challenge.request.recipient as `0x${string}`;

    if (!toAddress) {
      throw new Error("PaymentIntent did not return expected crypto deposit details");
    }
    if (!paymentCache.has(toAddress)) {
      throw new Error("Invalid payTo address: not found in server cache");
    }
    return toAddress;
  }

  // Create a new PaymentIntent to get a fresh crypto deposit address
  const amountInCents = Number(PRICE_USD) * 100;

  const paymentIntent = await stripeClient.paymentIntents.create({
    amount: amountInCents,
    currency: "usd",
    payment_method_types: ["crypto"],
    payment_method_data: {
      type: "crypto",
    },
    payment_method_options: {
      crypto: {
        mode: "deposit",
        deposit_options: {
          networks: ["tempo"],
        },
      } as Stripe.PaymentIntentCreateParams.PaymentMethodOptions.Crypto,
    },
    confirm: true,
  });

  if (!paymentIntent.next_action || !("crypto_display_details" in paymentIntent.next_action)) {
    throw new Error("PaymentIntent did not return expected crypto deposit details");
  }

  const depositDetails = paymentIntent.next_action.crypto_display_details as unknown as {
    deposit_addresses?: Record<string, { address?: string }>;
  };
  const payToAddress = depositDetails.deposit_addresses?.tempo?.address;

  if (!payToAddress) {
    throw new Error("PaymentIntent did not return expected crypto deposit details");
  }

  console.log(
    `Created PaymentIntent ${paymentIntent.id} for $${(amountInCents / 100).toFixed(
      2,
    )} -> ${payToAddress}`,
  );

  paymentCache.set(payToAddress, true);
  return payToAddress as `0x${string}`;
}

app.get("/paid", async (c) => {
  const request = c.req.raw;
  const recipientAddress = await createPayToAddress(request);

  const mppx = Mppx.create({
    methods: [
      tempo.charge({
        currency: PATH_USD,
        recipient: recipientAddress,
        testnet: true,
      }),
      stripe.charge({
        client: stripeClient,
        networkId: stripeNetworkId,
        paymentMethodTypes: ["card", "link"],
      }),
    ],
    secretKey: mppSecretKey,
  });

  const response = await Mppx.compose(
    mppx.tempo.charge({ amount: PRICE_USD, decimals: PRICE_DECIMALS, recipient: recipientAddress }),
    mppx.stripe.charge({ amount: PRICE_USD, currency: "usd" }),
  )(request);

  if (response.status === 402) return response.challenge;

  return response.withReceipt(Response.json({ foo: "bar" }));
});

serve({
  fetch: app.fetch,
  port: 4242,
});

console.log("Server listening at http://localhost:4242");

export { app };
