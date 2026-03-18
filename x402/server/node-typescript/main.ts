import { serve } from "@hono/node-server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { config } from "dotenv";
import { Hono } from "hono";
import NodeCache from "node-cache";
import Stripe from "stripe";

config();

const app = new Hono();

// Stripe handles payment processing and provides the crypto deposit address.
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY environment variable is required");
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  // @ts-expect-error
  apiVersion: "2026-03-04.preview",
  appInfo: {
    name: "stripe-samples/machine-payments",
    url: "https://github.com/stripe-samples/machine-payments",
    version: "1.0.0",
  },
});

// The facilitator verifies payment proofs and settles transactions on-chain.
// In this example, we us the x402.org testnet facilitator.
const facilitatorUrl = process.env.FACILITATOR_URL;
if (!facilitatorUrl) {
  console.error("❌ FACILITATOR_URL environment variable is required");
  process.exit(1);
}
const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });

// In-memory cache for deposit addresses (TTL: 5 minutes)
// NOTE: For production, use a distributed cache like Redis instead of node-cache
const paymentCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// This function determines where payments should be sent. It either:
// 1. Extracts the address from an existing payment header (for retry/verification), or
// 2. Creates a new Stripe PaymentIntent to generate a fresh deposit address.
// biome-ignore lint/suspicious/noExplicitAny: context type comes from x402 middleware
async function createPayToAddress(context: any): Promise<string> {
  // If a payment header exists, extract the destination address from it
  if (context.paymentHeader) {
    const decoded = JSON.parse(Buffer.from(context.paymentHeader, "base64").toString());
    const toAddress = decoded.payload?.authorization?.to;

    if (toAddress && typeof toAddress === "string") {
      if (!paymentCache.has(toAddress.toLowerCase())) {
        throw new Error("Invalid payTo address: not found in server cache");
      }
      return toAddress.toLowerCase();
    }

    throw new Error("PaymentIntent did not return expected crypto deposit details");
  }

  // Create a new PaymentIntent to get a fresh crypto deposit address
  const decimals = 6; // USDC has 6 decimals
  const amountInCents = Number(10000) / 10 ** (decimals - 2);

  const paymentIntent = await stripe.paymentIntents.create({
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
          networks: ["base"],
        },
      } as Stripe.PaymentIntentCreateParams.PaymentMethodOptions.Crypto,
    },
    confirm: true,
  });

  if (!paymentIntent.next_action || !("crypto_display_details" in paymentIntent.next_action)) {
    throw new Error("PaymentIntent did not return expected crypto deposit details");
  }

  // Extract the Base network deposit address from the PaymentIntent
  const depositDetails = paymentIntent.next_action.crypto_display_details as unknown as {
    deposit_addresses: Record<string, { address: string }>;
  };
  const payToAddress = depositDetails.deposit_addresses.base.address;

  console.log(
    `Created PaymentIntent ${paymentIntent.id} for $${(amountInCents / 100).toFixed(
      2,
    )} -> ${payToAddress}`,
  );

  paymentCache.set(payToAddress.toLowerCase(), true);
  return payToAddress.toLowerCase();
}

// The middleware protects the route and declares the payment requirements.
app.use(
  paymentMiddleware(
    {
      // Define pricing for protected endpoints
      "GET /paid": {
        accepts: [
          {
            scheme: "exact", // Exact amount payment scheme
            price: "$0.01", // Cost per request
            network: "eip155:84532", // Base Sepolia testnet
            payTo: createPayToAddress, // Dynamic address resolution
          },
        ],
        description: "Data retrieval endpoint",
        mimeType: "application/json",
      },
    },
    // Register the payment scheme handler for Base Sepolia
    new x402ResourceServer(facilitatorClient).register("eip155:84532", new ExactEvmScheme()),
  ),
);

// This endpoint is only accessible after valid payment is verified.
app.get("/paid", (c) => {
  return c.json({
    foo: "bar",
  });
});

serve({
  fetch: app.fetch,
  port: 4242,
});

console.log("Server listening at http://localhost:4242");

export { app };
