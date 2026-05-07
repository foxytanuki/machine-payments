# Flovia SDK integration concept for MPP API provider demos

## Positioning

Flovia is an analytics layer for API providers that connects payment context from MPP rails with provider-side API usage.

Stripe MPP and HitPay MPP can tell the provider that a payment session, challenge, transaction, or receipt exists. However, their dashboards do not naturally connect that payment information to API product behavior such as endpoint usage, workflow demand, route performance, or retained API demand.

Flovia fills that gap by joining:

- payment provider context: Stripe / HitPay
- payment rail context: MPP / x402-style payment flows
- API provider context: route, endpoint, workflow, request, response, latency
- usage outcome: challenge issued, paid access granted, completed request, failed request

The demo should present Flovia as complementary to Stripe and HitPay, not as a replacement.

> API providers keep using Stripe MPP or HitPay MPP for payment handling, and add Flovia SDK beside that integration to understand how paid API demand behaves after payment.

## Demo goal

The API provider adds three SDK layers in the same server integration area:

```text
API Provider server
  ├─ Stripe SDK / Stripe MPP
  ├─ HitPay SDK / HitPay MPP
  └─ Flovia SDK
```

The intended story is:

1. An agent or client calls a paid API endpoint such as `GET /paid`.
2. Stripe MPP or HitPay MPP handles the payment challenge, payment session, credential, and receipt flow.
3. Flovia SDK records the API route lifecycle around that protected handler.
4. Flovia joins payment context with endpoint usage.
5. The provider can analyze retained API demand by route, rail, payment provider, and workflow.

## Existing sample structure

Current Node/TypeScript samples are simple and route-local:

- `mpp/server/node-typescript/main.ts`
  - exposes `GET /paid`
  - creates Stripe `PaymentIntent` for crypto deposit address generation
  - builds an MPP charge with `Mppx.compose(...)`
  - returns a `402` challenge or a paid `200` response with receipt

- `hitpaympp/server/node-typescript/main.ts`
  - exposes `GET /paid`
  - creates `protectedPaid = mpp.protect(...)`
  - delegates the request to `protectedPaid(c.req.raw, undefined)`

Both samples already have a clean integration boundary: the paid route handler.

## Recommended SDK shape: one route-level wrapper

For the demo, Flovia should be introduced as a single wrapper around the payment-protected route.

The main API should look like this:

```ts
app.get("/paid", (c) =>
  flovia.trackPaidApi(c.req.raw, {
    provider: "stripe",
    rail: "mpp",
    endpoint: "/paid",
    amount: "1.00",
    currency: "usd",
    handler: () => stripeMppPaidHandler(c.req.raw),
  }),
);
```

And for HitPay:

```ts
app.get("/paid", (c) =>
  flovia.trackPaidApi(c.req.raw, {
    provider: "hitpay",
    rail: "mpp",
    endpoint: "/paid",
    amount: "1.00",
    currency: "sgd",
    handler: () => protectedPaid(c.req.raw, undefined),
  }),
);
```

This keeps the API provider experience simple:

> Wrap the existing MPP-protected endpoint once with Flovia SDK.

## Why one wrapper is enough for the first demo

A route-level wrapper can capture the usage lifecycle without requiring changes inside Stripe MPP or HitPay MPP internals.

It can record:

- endpoint: `/paid`
- method: `GET`
- payment provider: `stripe` or `hitpay`
- rail: `mpp`
- amount and currency configured for the route
- request start time
- response status
- latency
- whether the response was a payment challenge
- whether paid access completed
- error state
- optional workflow identifiers from headers
- optional caller or agent identifiers from headers

This is sufficient to show Flovia's core value:

> payment lifecycle + API endpoint usage in one analytics model.

## Optional payment context hook

A single wrapper can capture route usage, but provider-specific payment metadata may only exist inside payment-specific code.

For example, in the Stripe MPP sample, the Stripe `PaymentIntent` is created inside `createPayToAddress(...)`. That is where these values are available:

- `paymentIntent.id`
- amount
- currency
- crypto deposit address
- Tempo recipient address

To keep the integration visually centralized while still allowing rich context, the wrapper should pass an optional context API into the handler.

```ts
app.get("/paid", (c) =>
  flovia.trackPaidApi(c.req.raw, {
    provider: "stripe",
    rail: "mpp",
    endpoint: "/paid",
    amount: "1.00",
    currency: "usd",
    handler: async ({ attachPaymentContext }) => {
      const recipientAddress = await createPayToAddress(c.req.raw, {
        onPaymentIntent: (paymentIntent, payToAddress) =>
          attachPaymentContext({
            provider: "stripe",
            rail: "mpp",
            paymentIntentId: paymentIntent.id,
            amount: "1.00",
            currency: "usd",
            network: "tempo",
            recipient: payToAddress,
          }),
      });

      const response = await runStripeMppCharge(c.req.raw, recipientAddress);

      if (response.status === 402) return response.challenge;

      return response.withReceipt(Response.json({ foo: "bar" }));
    },
  }),
);
```

The important distinction:

- Flovia integration remains one route-level wrapper.
- Payment-specific code only calls a narrow callback when richer payment metadata is available.

## Proposed SDK interface

```ts
type PaymentProvider = "stripe" | "hitpay";
type PaymentRail = "mpp" | "x402";

type TrackPaidApiOptions = {
  provider: PaymentProvider;
  rail: PaymentRail;
  endpoint: string;
  method?: string;
  amount?: string;
  currency?: string;
  workflow?: string;
  metadata?: Record<string, string | number | boolean | null>;
  handler: (context: FloviaRequestContext) => Promise<Response> | Response;
};

type FloviaRequestContext = {
  requestId: string;
  attachPaymentContext: (context: FloviaPaymentContext) => void | Promise<void>;
  attachUsageContext: (context: Record<string, unknown>) => void | Promise<void>;
};

type FloviaPaymentContext = {
  provider: PaymentProvider;
  rail: PaymentRail;
  paymentIntentId?: string;
  paymentSessionId?: string;
  transactionId?: string;
  receiptId?: string;
  credentialId?: string;
  recipient?: string;
  network?: string;
  amount?: string;
  currency?: string;
  metadata?: Record<string, unknown>;
};
```

## Minimal Stripe MPP integration shape

Current route shape:

```ts
app.get("/paid", async (c) => {
  const request = c.req.raw;
  const recipientAddress = await createPayToAddress(request);
  const response = await Mppx.compose(...)(request);

  if (response.status === 402) return response.challenge;

  return response.withReceipt(Response.json({ foo: "bar" }));
});
```

With Flovia wrapper:

```ts
app.get("/paid", (c) =>
  flovia.trackPaidApi(c.req.raw, {
    provider: "stripe",
    rail: "mpp",
    endpoint: "/paid",
    amount: PRICE_USD,
    currency: "usd",
    handler: async ({ attachPaymentContext }) => {
      const request = c.req.raw;
      const recipientAddress = await createPayToAddress(request, {
        onPaymentIntent: ({ paymentIntent, payToAddress }) =>
          attachPaymentContext({
            provider: "stripe",
            rail: "mpp",
            paymentIntentId: paymentIntent.id,
            recipient: payToAddress,
            network: "tempo",
            amount: PRICE_USD,
            currency: "usd",
          }),
      });

      const response = await Mppx.compose(...)(request);

      if (response.status === 402) return response.challenge;

      return response.withReceipt(Response.json({ foo: "bar" }));
    },
  }),
);
```

## Minimal HitPay MPP integration shape

Current route shape:

```ts
const protectedPaid = mpp.protect(
  {
    amount: "1.00",
    currency: "sgd",
    description: "Machine payments sample",
  },
  async (_request: Request, _ctx: unknown) => Response.json({ foo: "bar" }),
);

app.get("/paid", (c) => protectedPaid(c.req.raw, undefined));
```

With Flovia wrapper:

```ts
app.get("/paid", (c) =>
  flovia.trackPaidApi(c.req.raw, {
    provider: "hitpay",
    rail: "mpp",
    endpoint: "/paid",
    amount: "1.00",
    currency: "sgd",
    handler: () => protectedPaid(c.req.raw, undefined),
  }),
);
```

If HitPay exposes payment/session details through `ctx`, the protected handler can optionally attach them:

```ts
const protectedPaid = mpp.protect(
  {
    amount: "1.00",
    currency: "sgd",
    description: "Machine payments sample",
  },
  async (_request: Request, ctx: unknown) => {
    // Optional: if ctx exposes payment/session identifiers, pass them to Flovia
    return Response.json({ foo: "bar" });
  },
);
```

For the first demo, the outer route wrapper is enough.

## Events Flovia should emit

The SDK can model the lifecycle as a small event sequence:

```text
paid_api.request_started
paid_api.payment_context_attached
paid_api.challenge_issued
paid_api.access_granted
paid_api.request_completed
paid_api.request_failed
```

Suggested event fields:

```ts
{
  requestId: "req_...",
  provider: "stripe",
  rail: "mpp",
  endpoint: "/paid",
  method: "GET",
  workflow: "agent-demo",
  amount: "1.00",
  currency: "usd",
  statusCode: 200,
  latencyMs: 123,
  paymentIntentId: "pi_...",
  paymentSessionId: "...",
  transactionId: "...",
  recipient: "0x...",
}
```

## Dashboard views enabled by this integration

Once route usage and payment context are joined, Flovia can show:

- paid API requests by endpoint
- challenge issued vs paid access completed
- latency and error rate for paid API routes
- retained API demand by route
- retained API demand by payment rail
- Stripe MPP vs HitPay MPP comparison
- workflow-level demand and revenue signals
- routes that receive payment attempts but do not retain usage

## Recommended demo narrative

Use this message:

> Stripe MPP and HitPay MPP handle payment. Flovia wraps the same protected API route once and connects that payment lifecycle to provider-side endpoint usage. This lets API providers see which routes, rails, and workflows create retained API demand.

Short version:

> Flovia SDK is a one-line wrapper around MPP-protected API routes, with optional hooks for richer payment metadata.

## Implementation principle

Keep the demo SDK shape small and provider-friendly:

1. One route-level wrapper for the common case.
2. Optional `attachPaymentContext(...)` callback for provider-specific details.
3. No requirement to modify Stripe SDK or HitPay SDK internals.
4. Preserve the existing `GET /paid` sample shape.
5. Make the Stripe and HitPay examples structurally aligned.
