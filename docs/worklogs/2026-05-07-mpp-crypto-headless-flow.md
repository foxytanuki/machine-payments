# MPP Crypto Payment Worklog

Date: 2026-05-07

## Scope

This note records the practical flow for testing an MPP crypto payment against the TypeScript sample on Tempo testnet. It focuses only on the crypto payment path: server challenge, client payment credential, and Stripe sandbox settlement.

## Environment

- Sample: `mpp/server/node-typescript`
- Endpoint: `GET /paid`
- Network: Tempo testnet / Moderato
- Stripe mode: sandbox / test mode
- Payment method: Stripe crypto PaymentIntent in deposit mode

## Required configuration

The repository root `.env` needs:

```env
STRIPE_SECRET_KEY=sk_test_...
MPPX_PRIVATE_KEY=0x...
```

`STRIPE_SECRET_KEY` lets the server create crypto PaymentIntents. `MPPX_PRIVATE_KEY` is the payer wallet key used by the local MPP client.

## Wallet funding

The payer wallet must have Tempo testnet funds before running the crypto payment client.

```bash
cd mpp/server/node-typescript
make wallet-address
make wallet-fund
```

The faucet helper can emit multiple transactions. That is expected because the faucet may fund more than one test asset needed for Tempo testnet payment flows.

## Payment flow

Start the paid resource server:

```bash
make run
```

The server listens on:

```text
http://localhost:4242/paid
```

Run the MPP crypto client in another terminal:

```bash
make client
```

Observed successful client response:

```text
200 OK
{"foo":"bar"}
```

This confirms the MPP request flow completed locally:

1. Client requested `GET /paid` without a payment credential.
2. Server created a Stripe crypto PaymentIntent and returned an MPP `402 Payment Required` challenge.
3. Client used `MPPX_PRIVATE_KEY` to satisfy the Tempo challenge.
4. Client retried the request with an MPP credential.
5. Server verified the credential and returned the paid response.

## Stripe sandbox settlement

After the local MPP flow succeeded, the Stripe PaymentIntent was still initially in `requires_action`:

```text
status=requires_action
amount_received=0
```

This is expected in Stripe sandbox mode because crypto PaymentIntents do not automatically monitor Tempo testnet deposits. For sandbox testing, use Stripe's crypto deposit simulation helper:

```bash
make payment-simulate PI=pi_...
```

Successful simulation moved the PaymentIntent to:

```text
status=succeeded
amount_received=100
```

Failure simulation is also available:

```bash
make payment-simulate PI=pi_... OUTCOME=failed
```

Observed failed simulation result:

```text
status=requires_payment_method
amount_received=0
```

## Mainnet note

In live mode on supported mainnet networks, Stripe is expected to monitor real crypto deposits and advance the PaymentIntent without the sandbox simulation helper. The simulation helper is only for sandbox/testnet development.
