# MPP TypeScript Sample Runtime Error: Missing `decimals` in Charge Requests

## Summary

The MPP TypeScript server sample can return `500 Internal Server Error` when a client requests `GET /paid`. The failure occurs while constructing payment challenges because route-level `tempo.charge` and `stripe.charge` requests omit the required `decimals` field.

The issue was reproduced with the repository's MPP TypeScript sample and `mppx@0.6.8`. The same validation path still exists in `mppx@0.6.15`, so explicitly passing `decimals` remains the safe fix.

## Environment

- Sample: `mpp/server/node-typescript`
- Runtime: Node.js `v24.14.1`
- Package manager: `pnpm v10.17.0`
- Initial SDK version in repo: `mppx@0.6.8`
- Latest checked SDK version: `mppx@0.6.15`
- Network: Tempo testnet / Moderato
- Server endpoint: `GET /paid`

## Reproduction

1. Configure the MPP TypeScript sample with a Stripe test secret key.
2. Start the server:

   ```bash
   cd mpp/server/node-typescript
   make run
   ```

3. Request the paid endpoint with a client:

   ```bash
   make client
   ```

4. The server creates a Stripe crypto PaymentIntent and deposit address, then fails while building the MPP challenge.

Observed server log:

```text
Created PaymentIntent pi_... for $1.00 -> 0x...
$ZodError: [
  {
    "expected": "number",
    "code": "invalid_type",
    "path": [
      "decimals"
    ],
    "message": "Invalid input"
  }
]
    at Module.fromMethod (.../mppx/src/PaymentRequest.ts:88:32)
    at Object.charge (.../mppx/src/server/Mppx.ts:637:45)
    at Array.<anonymous> (.../mpp/server/node-typescript/main.ts:126:17)
```

Observed client response:

```text
500 Internal Server Error
Internal Server Error
```

## Root cause

The server registers Tempo and Stripe methods, then creates route-level handlers through `Mppx.compose`. On an unauthenticated request, `Mppx.compose` attempts to build every advertised challenge before returning the merged `402` response.

The first problematic route-level call was:

```ts
mppx.tempo.charge({ amount: PRICE_USD, recipient: recipientAddress })
```

At runtime, `mppx` validates the merged payment request via `PaymentRequest.fromMethod(...)`. The Tempo charge request schema expects `decimals` to be a number. Since `decimals` is not supplied by the route options or method defaults, schema validation throws before the server can return a `402 Payment Required` challenge.

After adding `decimals` to the Tempo handler, the same validation issue also applies to the Stripe handler in the composed route:

```ts
mppx.stripe.charge({ amount: PRICE_USD, currency: "usd" })
```

The Stripe charge request also needs `decimals`, typically `2` for USD.

This is a server-side sample issue, not a client script issue. The failure happens before the client can authorize or retry a payment.

## Expected behavior

The first unauthenticated request to `GET /paid` should return a valid `402 Payment Required` response containing the MPP challenge.

## Actual behavior

The server returns `500 Internal Server Error` because challenge construction fails during request validation.

## Proposed fix

Pass `decimals` when creating all route-level charge handlers:

```ts
const PRICE_USD = "1";
const PRICE_DECIMALS = 6;
const STRIPE_PRICE_DECIMALS = 2;

const response = await Mppx.compose(
  mppx.tempo.charge({
    amount: PRICE_USD,
    decimals: PRICE_DECIMALS,
    recipient: recipientAddress,
  }),
  mppx.stripe.charge({
    amount: PRICE_USD,
    currency: "usd",
    decimals: STRIPE_PRICE_DECIMALS,
  }),
)(request);
```

If the amount is intended to be a standard USD decimal amount rather than token base units, the sample should also clarify how `amount` and `decimals` are interpreted for Tempo charges.

## Related observations

- The repository's `docs/MPPPayments.md` SPT example passes `decimals: 2` for Stripe charges, but the crypto Node.js snippet previously omitted `decimals`.
- The Python MPP sample already uses a Tempo charge shape that includes chain/testnet-specific details and uses an amount of `"0.01"`.
- The TypeScript sample currently uses `PRICE_USD = "1"` for both Tempo and Stripe flows, which differs from the documentation text that describes crypto as `0.01 USD` and SPT as `1 USD`.
- Updating `mppx` from `0.6.8` to `0.6.15` does not remove the need for schema-valid request parameters.

## Impact

Users following the TypeScript MPP sample can hit a server-side 500 during the first local test, before any wallet funding or Stripe crypto deposit simulation issues become relevant. This blocks the documented `GET /paid` flow and makes the sample appear broken.

## Suggested upstream PR scope

1. Add `decimals` to all TypeScript charge route options that advertise MPP challenges.
2. Align TypeScript sample pricing with the docs, or document why the sample uses a shared `PRICE_USD` for both Tempo and Stripe.
3. Consider adding a regression test that asserts `GET /paid` returns `402` instead of `500` when no payment credential is provided.
4. Optionally update `mppx` to the latest patch release if maintainers want the sample to track current SDK behavior.
