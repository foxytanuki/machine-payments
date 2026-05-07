# MPP Crypto Headless Flow Worklog

Date: 2026-05-07

## Context

We tested the MPP TypeScript sample on a headless Ubuntu server. The standard `mppx account create` flow failed because it depends on an OS keychain/Secret Service backend. To keep the sample usable in server environments, we added an environment-variable based client wallet flow using `MPPX_PRIVATE_KEY`.

## Changes made

- Added a headless MPP client script for `GET /paid`.
- Added wallet helper scripts:
  - `make wallet-address`
  - `make wallet-fund`
- Switched the TypeScript sample scripts to load the repository root `.env` through `dotenvx`.
- Upgraded the MPP TypeScript sample from `mppx@0.6.8` to `mppx@0.6.15`.
- Added missing `decimals` values to composed MPP charge handlers:
  - Tempo charge: `decimals: 6`
  - Stripe SPT charge: `decimals: 2`
- Added a sandbox crypto deposit simulation helper:
  - `make payment-simulate PI=pi_...`
  - `make payment-simulate PI=pi_... OUTCOME=failed`
- Documented the upstream issue in `docs/issues/mpp-typescript-decimals-runtime-error.md`.

## Runtime issue found

The TypeScript MPP server returned `500 Internal Server Error` before it could return a `402 Payment Required` challenge.

The root cause was missing `decimals` fields in route-level charge requests passed to `Mppx.compose`. On an unauthenticated request, `Mppx.compose` builds every advertised challenge, so both the Tempo and Stripe charge handlers need schema-valid request parameters.

Observed failure:

```text
$ZodError: [
  {
    "expected": "number",
    "code": "invalid_type",
    "path": ["decimals"],
    "message": "Invalid input"
  }
]
```

Fix:

```ts
mppx.tempo.charge({
  amount: PRICE_USD,
  decimals: 6,
  recipient: recipientAddress,
})

mppx.stripe.charge({
  amount: PRICE_USD,
  currency: "usd",
  decimals: 2,
})
```

## Test flow

1. Configure root `.env`:

   ```env
   STRIPE_SECRET_KEY=sk_test_...
   MPPX_PRIVATE_KEY=0x...
   ```

2. Fund the Tempo testnet wallet:

   ```bash
   cd mpp/server/node-typescript
   make wallet-address
   make wallet-fund
   ```

3. Run the paid server:

   ```bash
   make run
   ```

4. Run the MPP client in another terminal:

   ```bash
   make client
   ```

5. Observed successful MPP client response:

   ```text
   200 OK
   {"foo":"bar"}
   ```

## Stripe sandbox settlement

The local MPP credential flow succeeded, but the Stripe crypto PaymentIntent stayed in `requires_action` because Stripe sandbox PaymentIntents do not automatically monitor Tempo testnet deposits.

We added a simulation helper for the Stripe test helper endpoint:

```bash
make payment-simulate PI=pi_...
```

Successful simulation result:

```json
{
  "status": "succeeded",
  "amount_received": 100,
  "latest_charge": "py_..."
}
```

Failure simulation result:

```text
status=requires_payment_method amount_received=0
```

## Mainnet note

In live mode on mainnet, Stripe is expected to monitor supported network deposits and advance the crypto PaymentIntent without the simulation helper. The helper is for sandbox/testnet development only.

## Validation

- `pnpm run build` passed.
- `pnpm exec biome check .` passed functionally but reported a Biome schema version mismatch warning/info before the schema was updated.
