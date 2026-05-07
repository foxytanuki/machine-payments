.PHONY: install run client wallet-address wallet-fund lint format typecheck test ci

install:
	pnpm install

run:
	pnpm run dev

client:
	pnpm run client

wallet-address:
	pnpm run wallet:address

wallet-fund:
	pnpm run wallet:fund

lint:
	pnpm exec biome check .

format:
	pnpm exec biome check --write .

typecheck:
	pnpm run build

test:
	pnpm exec vitest run

ci: install lint typecheck test
