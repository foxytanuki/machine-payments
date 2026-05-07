# MPP REST API - TypeScript

This is the TypeScript implementation of the MPP REST API sample using Hono.

## Requirements

- Node.js 20+
- [pnpm](https://pnpm.io/) package manager
- `make`
- Stripe account with crypto payments enabled
- EVM wallet with testnet USDC on Tempo testnet

These examples run on Tempo testnet. If you need testnet funds, you can use the [Tempo faucet](https://docs.tempo.xyz/quickstart/faucet).

## Setup

1. Configure environment variables:
```bash
cp ../../../.env.template ../../../.env
# Edit ../../../.env with your credentials
```

2. Install dependencies:
```bash
make install
```

## Run the server

- `make run` — start the local sample server

```bash
make run
```

## Headless test client

If your environment doesn't have an OS keychain for `mppx account create`, create a
test-only private key and pass it through the repository root `.env`:

```bash
openssl rand -hex 32
```

Add it to `../../../.env` with a `0x` prefix:

```bash
MPPX_PRIVATE_KEY=0x...
```

View the corresponding account address and fund it with Tempo testnet funds:

```bash
make wallet-address
make wallet-fund
```

Then call the paid endpoint with the local client:

```bash
make client
# or target another URL
pnpm run client -- http://localhost:4242/paid
```

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
purl http://localhost:4242/paid
```
