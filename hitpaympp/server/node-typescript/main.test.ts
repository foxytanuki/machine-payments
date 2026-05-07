import type { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Stub env vars before importing the app
vi.stubEnv("HITPAY_API_KEY", "hitpay_test_fake");
vi.stubEnv("HITPAY_MPP_ENDPOINT", "https://example.com/mpp");

// Mock @hono/node-server so `serve()` is a no-op
vi.mock("@hono/node-server", () => ({
	serve: vi.fn(),
}));

// Mock process.exit to prevent it from killing the test runner
vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

// Mock HitPay MPP so we don't need real payment infra
vi.mock("@hit-pay/mpp", () => ({
	createMpp: vi.fn().mockReturnValue({
		protect: vi
			.fn()
			.mockImplementation(
				(
					_price: unknown,
					handler: (req: Request, ctx: unknown) => Response | Promise<Response>,
				) =>
					(req: Request, ctx: unknown) =>
						handler(req, ctx),
			),
	}),
}));

let app: Hono;

beforeAll(async () => {
	const mod = await import("./main.js");
	app = mod.app;
});

describe("hitpay mpp server", () => {
	it("exports a Hono app", () => {
		expect(app).toBeDefined();
		expect(app.fetch).toBeInstanceOf(Function);
	});

	it("GET /paid returns JSON with mocked protection", async () => {
		const res = await app.request("/paid");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ foo: "bar" });
	});
});
