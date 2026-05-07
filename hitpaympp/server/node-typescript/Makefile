.PHONY: install run client lint format typecheck test ci

install:
	pnpm install

run:
	pnpm run dev

client:
	pnpm run client

lint:
	pnpm exec biome check .

format:
	pnpm exec biome check --write .

typecheck:
	pnpm run build

test:
	pnpm exec vitest run

ci: install lint typecheck test
