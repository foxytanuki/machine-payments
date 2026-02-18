.PHONY: install run lint format typecheck test ci

install:
	uv sync

run:
	uv run python main.py

lint:
	uv run ruff check .
	uv run ruff format --check .

format:
	uv run ruff check --fix .
	uv run ruff format .

typecheck:
	uv run pyright

test:
	uv run pytest

ci: install lint typecheck test
