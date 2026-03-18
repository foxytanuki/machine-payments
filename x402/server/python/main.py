import base64
import json
import os
import sys
import traceback
from typing import Any, cast

import stripe
import uvicorn
from cachetools import TTLCache
from dotenv import load_dotenv
from fastapi import FastAPI
from x402.http import FacilitatorConfig, HTTPFacilitatorClient, PaymentOption
from x402.http.middleware.fastapi import PaymentMiddlewareASGI
from x402.http.types import RouteConfig
from x402.mechanisms.evm.exact import ExactEvmServerScheme
from x402.server import x402ResourceServer


def debug_print(*args, **kwargs):
    print("[DEBUG]", *args, **kwargs, file=sys.stderr)


load_dotenv()

# Stripe handles payment processing and provides the crypto deposit address.
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
if not STRIPE_SECRET_KEY:
    debug_print("Missing STRIPE_SECRET_KEY environment variable")
    raise ValueError("STRIPE_SECRET_KEY environment variable is required")

stripe.api_key = STRIPE_SECRET_KEY
stripe.api_version = "2026-03-04.preview"
stripe.set_app_info(
    "stripe-samples/machine-payments",
    url="https://github.com/stripe-samples/machine-payments",
    version="1.0.0",
)

# The facilitator verifies payment proofs and settles transactions on-chain.
# In this example, we use the x402.org testnet facilitator.
FACILITATOR_URL = os.getenv("FACILITATOR_URL", "https://www.x402.org/facilitator")
debug_print(f"Using FACILITATOR_URL: {FACILITATOR_URL}")
facilitator = HTTPFacilitatorClient(FacilitatorConfig(url=FACILITATOR_URL))

# Set up resource server and register the payment scheme handler for Base Sepolia
server = x402ResourceServer(facilitator)
server.register("eip155:84532", ExactEvmServerScheme())  # type: ignore[arg-type]

# In-memory cache for deposit addresses (TTL: 5 minutes, max 1024 entries)
# NOTE: For production, use a distributed cache like Redis instead of cachetools
payment_cache: TTLCache[str, bool] = TTLCache(maxsize=1024, ttl=300)


async def create_pay_to_address(context: Any) -> str:
    """
    This function determines where payments should be sent. It either:
    1. Extracts the address from an existing payment header (for retry/verification), or
    2. Creates a new Stripe PaymentIntent to generate a fresh deposit address.
    """
    debug_print("Entering create_pay_to_address()")
    payment_header = getattr(context, "payment_header", None) or getattr(
        context, "paymentHeader", None
    )
    if payment_header:
        debug_print("Found payment_header in context")
        try:
            decoded_bytes = base64.b64decode(payment_header)
            debug_print(f"Decoded base64 payment_header: {decoded_bytes!r}")
            decoded = json.loads(decoded_bytes.decode())
            debug_print(f"Decoded JSON payment_header: {decoded}")
            to_address = decoded.get("payload", {}).get("authorization", {}).get("to")
            debug_print(f"Extracted to_address from payment_header: {to_address}")

            if to_address and isinstance(to_address, str):
                if to_address.lower() not in payment_cache:
                    debug_print(
                        f"Address {to_address.lower()} not found in payment_cache"
                    )
                    raise ValueError("Invalid payTo address: not found in server cache")
                debug_print(f"Returning existing to_address: {to_address.lower()}")
                return to_address.lower()
        except Exception as exc:
            debug_print("Error while parsing payment_header:")
            traceback.print_exc()
            raise ValueError("Invalid payment header") from exc

        debug_print("Payment header missing destination address")
        raise ValueError("Payment header missing destination address")

    # Create a new PaymentIntent to get a fresh crypto deposit address
    decimals = 6  # USDC has 6 decimals
    amount_in_cents = int(10000 / (10 ** (decimals - 2)))
    debug_print(f"Creating PaymentIntent for amount_in_cents: {amount_in_cents}")

    try:
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
                        "deposit_options": {"networks": ["base"]},
                    }
                },
            ),
            confirm=True,
        )
    except Exception:
        debug_print("Error while creating PaymentIntent:")
        traceback.print_exc()
        raise

    debug_print(f"Received PaymentIntent: {payment_intent}")

    next_action = payment_intent.get("next_action", {})
    deposit_details = next_action.get("crypto_display_details", {})
    debug_print(f"next_action: {next_action}")
    debug_print(f"deposit_details: {deposit_details}")

    if not deposit_details:
        debug_print("Missing crypto_display_details in PaymentIntent next_action")
        raise ValueError("PaymentIntent did not return expected crypto deposit details")

    # Extract the Base network deposit address from the PaymentIntent
    deposit_addresses = deposit_details.get("deposit_addresses", {})
    base_address = deposit_addresses.get("base", {})
    pay_to_address = base_address.get("address")
    debug_print(
        f"deposit_addresses: {deposit_addresses}, base_address: {base_address}, pay_to_address: {pay_to_address}"  # noqa: E501
    )

    if not pay_to_address:
        debug_print("Missing deposit address in PaymentIntent deposit_details")
        raise ValueError("PaymentIntent did not return expected crypto deposit details")

    print(
        f"Created PaymentIntent {payment_intent['id']} "
        f"for ${amount_in_cents / 100:.2f} -> {pay_to_address}"
    )

    payment_cache[pay_to_address.lower()] = True
    debug_print(f"Added {pay_to_address.lower()} to payment_cache")

    return pay_to_address.lower()


# Define resource configuration for the x402 payment middleware
routes = {
    # Define pricing for protected endpoints
    "GET /paid": RouteConfig(
        accepts=[
            PaymentOption(
                scheme="exact",  # Exact amount payment scheme
                price="$0.01",  # Cost per request
                network="eip155:84532",  # Base Sepolia testnet
                pay_to=create_pay_to_address,  # Dynamic address resolution
            )
        ],
        description="Data retrieval endpoint",
        mime_type="application/json",
    )
}


# Create FastAPI app
app = FastAPI(title="x402 REST API")

# Add x402 middleware
app.add_middleware(PaymentMiddlewareASGI, routes=routes, server=server)


# This endpoint is only accessible after valid payment is verified.
@app.get("/paid")
async def get_paid():
    debug_print("Serving /paid endpoint")
    return {"foo": "bar"}


if __name__ == "__main__":
    print("Server listening at http://localhost:4242")
    uvicorn.run(app, host="0.0.0.0", port=4242)
