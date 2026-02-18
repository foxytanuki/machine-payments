import base64
import json

import pytest
from fastapi import FastAPI


def _make_payment_header(address: str) -> str:
    """Build a Payment authorization header with the given recipient address."""
    challenge_request = base64.b64encode(
        json.dumps({"recipient": address}).encode()
    ).decode()
    credential = {
        "challenge": {
            "id": "test-id",
            "realm": "test-realm",
            "method": "tempo",
            "intent": "charge",
            "request": challenge_request,
        },
        "payload": {},
    }
    return "Payment " + base64.b64encode(json.dumps(credential).encode()).decode()


@pytest.fixture(autouse=True)
def _set_env(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")


def test_app_is_fastapi():
    from main import app

    assert isinstance(app, FastAPI)


def test_extract_recipient_returns_none_for_no_header():
    from main import _extract_recipient_from_authorization

    assert _extract_recipient_from_authorization(None) is None
    assert _extract_recipient_from_authorization("Bearer token") is None


def test_extract_recipient_with_valid_payment_header():
    from main import _extract_recipient_from_authorization, valid_pay_to_addresses

    address = "0xabc123"
    valid_pay_to_addresses.add(address)

    header = _make_payment_header(address)
    result = _extract_recipient_from_authorization(header)
    assert result == address

    # cleanup
    valid_pay_to_addresses.discard(address)


def test_extract_recipient_rejects_unknown_address():
    from main import _extract_recipient_from_authorization

    header = _make_payment_header("0xunknown")

    with pytest.raises(ValueError, match="not found in server cache"):
        _extract_recipient_from_authorization(header)
