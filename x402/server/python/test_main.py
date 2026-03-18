import pytest
from fastapi import FastAPI


@pytest.fixture(autouse=True)
def _set_env(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    monkeypatch.setenv("FACILITATOR_URL", "https://example.com/facilitator")


def test_app_is_fastapi():
    from main import app

    assert isinstance(app, FastAPI)


def test_app_has_paid_route():
    from main import app

    routes = [getattr(r, "path", None) for r in app.routes]
    assert "/paid" in routes
