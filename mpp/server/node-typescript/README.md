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
cp ../../../.env.template .env
# Edit .env with your credentials
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
