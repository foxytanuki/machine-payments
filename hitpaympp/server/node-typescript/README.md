# HitPay MPP - TypeScript

This is the TypeScript implementation of the HitPay MPP sample using Hono. It demonstrates a `GET /paid` endpoint protected by a one-time sandbox payment.

HitPay MPP is an early preview and this sample is intended for sandbox use only.

## Requirements

- Node.js 20+
- [pnpm](https://pnpm.io/) package manager
- `make`
- HitPay sandbox API key
- HitPay webhook configured for `https://sandbox.mpp.hitpay.dev/v1/webhook/hitpay` with the `payment_request.completed` event

## Setup

1. Configure environment variables:
```bash
cp ../../../.env.template ../../../.env
# Edit ../../../.env with your HitPay credentials
```

Required and optional variables:

- `HITPAY_API_KEY` — required HitPay API key
- `HITPAY_WEBHOOK_SALT` — optional webhook signing salt
- `HITPAY_MPP_ENDPOINT` — optional, defaults to `https://sandbox.mpp.hitpay.dev`
- `HITPAY_MPP_AUTO_PAY` — optional client auto-pay flag, set to `true` to enable
- `HITPAY_MPP_TIMEOUT_MS` — optional client polling timeout, defaults to 10 minutes

2. Install dependencies:
```bash
make install
```

## Run the server

- `make run` — start the local sample server

```bash
make run
```

## Test client

Call the paid endpoint with the local client:

```bash
make client
# or target another URL
pnpm run client -- http://localhost:4242/paid
```

The client logs the payment amount, currency, and checkout URL when challenged. Open the checkout URL, complete the sandbox payment, then press Enter in the client terminal to continue polling and retry the paid request.

## Development commands

- `make lint` — run lint and formatting checks without changing files
- `make format` — apply automatic formatting fixes
- `make typecheck` — run the sample's type checker or build validation
- `make test` — run the automated test suite
- `make ci` — run the full local CI sequence (`install`, `lint`, `typecheck`, and `test`)

```bash
make lint
make format
make typecheck
make test
make ci
```

## Test the sample

```bash
curl http://localhost:4242/paid
```

This command only verifies the unpaid request path. A successful result is a
`402 Payment Required` response with a `WWW-Authenticate: Payment` header and a
JSON body containing `challenge.methodDetails.checkout_url`.

## Manual sandbox workflow

Use this workflow when validating the full HitPay MPP one-time payment flow:

1. Start the sample server:

```bash
make run
```

2. In another terminal, verify that the endpoint emits a payment challenge:

```bash
curl -i http://localhost:4242/paid
```

Expected result: `402 Payment Required` with a HitPay sandbox checkout URL. This
does not complete the payment; it only confirms that challenge creation works.

3. Run the client:

```bash
make client
```

The client prints the checkout URL on its own line, then waits:

```text
Checkout URL:
https://securecheckout.sandbox.hit-pay.com/...
Complete the sandbox payment, then press Enter to continue...
```

4. Open the checkout URL in a browser and complete the sandbox payment.

5. Return to the client terminal and press Enter. The client then polls the MPP
broker, retries the paid request with the generated credential, verifies the
receipt, and prints the result.

Expected successful output includes:

```text
200 OK
{ foo: 'bar' }
Receipt claims: ...
Receipt JWS: ...
```

If the client times out before payment completion, increase
`HITPAY_MPP_TIMEOUT_MS` in the repository root `.env` file.
