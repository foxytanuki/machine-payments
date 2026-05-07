import { privateKeyToAccount } from "viem/accounts";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const paymentIntentId = args[0];
const outcome = args[1] ?? "success";

if (!paymentIntentId) {
  throw new Error("Usage: pnpm run payment:simulate -- <payment_intent_id> [success|failed]");
}

if (outcome !== "success" && outcome !== "failed") {
  throw new Error("Simulation outcome must be either 'success' or 'failed'");
}

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  throw new Error("STRIPE_SECRET_KEY environment variable is required");
}

const buyerWallet = (() => {
  if (process.env.SIMULATE_BUYER_WALLET) return process.env.SIMULATE_BUYER_WALLET;

  const privateKey = process.env.MPPX_PRIVATE_KEY;
  if (privateKey === undefined || !privateKey.startsWith("0x")) {
    throw new Error(
      "Set MPPX_PRIVATE_KEY or SIMULATE_BUYER_WALLET to provide the buyer wallet address",
    );
  }

  return privateKeyToAccount(privateKey as `0x${string}`).address;
})();

const transactionHash =
  outcome === "failed"
    ? "0x000000000000000000000000000000000000000000000000000000testfailed"
    : "0x00000000000000000000000000000000000000000000000000000testsuccess";

const form = new URLSearchParams({
  transaction_hash: transactionHash,
  network: process.env.SIMULATE_CRYPTO_NETWORK ?? "tempo",
  token_currency: process.env.SIMULATE_TOKEN_CURRENCY ?? "usdc",
  buyer_wallet: buyerWallet,
});

type StripePaymentIntent = {
  amount_received?: number;
  id?: string;
  latest_charge?: string | null;
  status?: string;
};

class StripeRequestError extends Error {
  constructor(
    readonly code: string | undefined,
    message: string,
    readonly paymentIntent: StripePaymentIntent | undefined,
  ) {
    super(message);
  }
}

async function stripeRequest(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.stripe.com${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${stripeSecretKey}:`).toString("base64")}`,
      "Stripe-Version": "2026-03-04.preview",
      ...init?.headers,
    },
  });

  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error as
      | {
          code?: string;
          message?: string;
          payment_intent?: StripePaymentIntent;
        }
      | undefined;
    throw new StripeRequestError(
      error?.code,
      error?.message ?? JSON.stringify(body),
      error?.payment_intent,
    );
  }

  return body;
}

function printPaymentIntent(paymentIntent: StripePaymentIntent) {
  console.log(
    JSON.stringify(
      {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount_received: paymentIntent.amount_received,
        latest_charge: paymentIntent.latest_charge,
      },
      null,
      2,
    ),
  );
}

async function retrievePaymentIntent(): Promise<StripePaymentIntent> {
  return stripeRequest(`/v1/payment_intents/${paymentIntentId}`) as Promise<StripePaymentIntent>;
}

const initialPaymentIntent = await retrievePaymentIntent();
if (initialPaymentIntent.status === "succeeded") {
  console.log("PaymentIntent already succeeded; no simulation needed.");
  printPaymentIntent(initialPaymentIntent);
  process.exit(0);
}

if (initialPaymentIntent.status !== "requires_action") {
  console.error("PaymentIntent is not ready for crypto deposit simulation.");
  printPaymentIntent(initialPaymentIntent);
  process.exit(1);
}

console.log(`Simulating ${outcome} crypto deposit for ${paymentIntentId}`);
try {
  await stripeRequest(
    `/v1/test_helpers/payment_intents/${paymentIntentId}/simulate_crypto_deposit`,
    {
      method: "POST",
      body: form,
    },
  );
} catch (error) {
  if (error instanceof StripeRequestError && error.code === "payment_intent_unexpected_state") {
    console.error(error.message);
    if (error.paymentIntent) printPaymentIntent(error.paymentIntent);
    process.exit(error.paymentIntent?.status === "succeeded" ? 0 : 1);
  }

  throw error;
}

for (let attempt = 0; attempt < 15; attempt++) {
  const paymentIntent = await retrievePaymentIntent();
  const status = paymentIntent.status;
  const amountReceived = paymentIntent.amount_received;

  console.log(`status=${status} amount_received=${amountReceived}`);
  if (status === "succeeded" || status === "requires_payment_method" || status === "canceled") {
    break;
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));
}
