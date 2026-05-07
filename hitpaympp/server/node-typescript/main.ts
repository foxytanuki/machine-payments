import { createMpp } from "@hit-pay/mpp";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

if (!process.env.HITPAY_API_KEY) {
	console.error("❌ HITPAY_API_KEY environment variable is required");
	process.exit(1);
}

const app = new Hono();
const port = Number(process.env.PORT ?? 4242);
const endpoint =
	process.env.HITPAY_MPP_ENDPOINT ?? "https://sandbox.mpp.hitpay.dev";

const mpp = createMpp({
	apiKey: process.env.HITPAY_API_KEY,
	endpoint,
	webhookSalt: process.env.HITPAY_WEBHOOK_SALT,
});

const protectedPaid = mpp.protect(
	{
		amount: "1.00",
		currency: "sgd",
		description: "Machine payments sample",
	},
	async (_request: Request, _ctx: unknown) => Response.json({ foo: "bar" }),
);

app.get("/paid", (c) => protectedPaid(c.req.raw, undefined));

serve({
	fetch: app.fetch,
	port,
});

console.log(`Server listening at http://localhost:${port}`);
console.log(`HitPay MPP endpoint: ${endpoint}`);

export { app };
