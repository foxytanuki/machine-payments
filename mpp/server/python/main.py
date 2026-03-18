import os
from typing import Any, cast

import stripe
import uvicorn
from cachetools import TTLCache
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from mpp import Challenge, Credential
from mpp._parsing import _b64_decode
from mpp.methods.tempo import (
    ChargeIntent,  # pyright: ignore[reportPrivateImportUsage]
    tempo,  # pyright: ignore[reportPrivateImportUsage]
)
from mpp.server import Mpp  # pyright: ignore[reportPrivateImportUsage]

load_dotenv()

# Stripe handles payment processing and provides the crypto deposit address.
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
if not STRIPE_SECRET_KEY:
    raise ValueError("STRIPE_SECRET_KEY environment variable is required")

stripe.api_key = STRIPE_SECRET_KEY
stripe.api_version = "2026-03-04.preview"
stripe.set_app_info(
    "stripe-samples/machine-payments",
    url="https://github.com/stripe-samples/machine-payments",
    version="1.0.0",
)

# Secret used to secure payment challenges.
# https://mpp.dev/protocol/challenges#challenge-binding
mpp_secret_key = os.urandom(32).hex()

# In-memory cache for deposit addresses (TTL: 5 minutes, max 1024 entries)
# NOTE: For production, use a distributed cache like Redis instead of cachetools
payment_cache: TTLCache[str, bool] = TTLCache(maxsize=1024, ttl=300)


def _extract_recipient_from_authorization(authorization: str | None) -> str | None:
    if not authorization or not authorization.startswith("Payment "):
        return None

    credential = Credential.from_authorization(authorization)
    request = _b64_decode(credential.challenge.request)
    to_address = request.get("recipient")

    if to_address and isinstance(to_address, str):
        normalized = to_address.lower()
        if normalized not in payment_cache:
            raise ValueError("Invalid payTo address: not found in server cache")
        return normalized

    raise ValueError("PaymentIntent did not return expected crypto deposit details")


async def create_pay_to_address(request: Request) -> str:
    """
    This function determines where payments should be sent. It either:
    1. Extracts the address from an existing payment header (for retry/verification), or
    2. Creates a new Stripe PaymentIntent to generate a fresh deposit address.
    """
    recipient = _extract_recipient_from_authorization(
        request.headers.get("authorization")
    )
    if recipient:
        return recipient

    # Create a new PaymentIntent to get a fresh crypto deposit address.
    decimals = 6  # USDC has 6 decimals
    amount_in_cents = int(10000 / (10 ** (decimals - 2)))

    payment_intent = stripe.PaymentIntent.create(
        amount=amount_in_cents,
        currency="usd",
        payment_method_types=["crypto"],
        payment_method_data={"type": "crypto"},
        payment_method_options=cast(
            Any,
            {
                "crypto": {
                    "mode": "deposit",
                    "deposit_options": {"networks": ["tempo"]},
                }
            },
        ),
        confirm=True,
    )

    next_action = payment_intent.get("next_action", {})
    deposit_details = next_action.get("crypto_display_details", {})
    if not deposit_details:
        raise ValueError("PaymentIntent did not return expected crypto deposit details")

    deposit_addresses = deposit_details.get("deposit_addresses", {})
    tempo_address = deposit_addresses.get("tempo", {})
    pay_to_address = tempo_address.get("address")

    if not pay_to_address:
        raise ValueError("PaymentIntent did not return expected crypto deposit details")

    print(
        f"Created PaymentIntent {payment_intent['id']} "
        f"for ${amount_in_cents / 100:.2f} -> {pay_to_address}"
    )

    normalized = pay_to_address.lower()
    payment_cache[normalized] = True
    return normalized


app = FastAPI(title="MPP REST API")


@app.get("/paid")
async def get_api(request: Request):
    recipient_address = await create_pay_to_address(request)

    mpp = Mpp.create(
        method=tempo(
            currency="0x20c0000000000000000000000000000000000000",
            recipient=recipient_address,
            intents={"charge": ChargeIntent()},
            chain_id=42431,
        ),
        secret_key=mpp_secret_key,
    )

    result = await mpp.charge(
        authorization=request.headers.get("authorization"),
        amount="0.01",
    )

    if isinstance(result, Challenge):
        return JSONResponse(
            status_code=402,
            content={"error": "Payment required"},
            headers={"WWW-Authenticate": result.to_www_authenticate(mpp.realm)},
        )

    _credential, receipt = result

    response = JSONResponse(content={"foo": "bar"})
    response.headers["Authentication-Info"] = receipt.to_payment_receipt()
    return response


if __name__ == "__main__":
    print("Server listening at http://localhost:4242")
    uvicorn.run(app, host="0.0.0.0", port=4242)
