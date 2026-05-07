import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { mppFetch } from "@hit-pay/mpp-client";

const url = process.argv[2] ?? "http://localhost:4242/paid";
const autoPay = process.env.HITPAY_MPP_AUTO_PAY === "true";
const timeoutMs = Number(process.env.HITPAY_MPP_TIMEOUT_MS ?? 10 * 60_000);

async function waitForPayment() {
	if (autoPay) return;

	const rl = createInterface({ input, output });
	try {
		await rl.question(
			"Complete the sandbox payment, then press Enter to continue...",
		);
	} finally {
		rl.close();
	}
}

const { response, receipt, receiptJws } = await mppFetch(url, {
	autoPay,
	timeoutMs,
	onChallenge: async (challenge) => {
		console.log(`Payment required: ${challenge.amount} ${challenge.currency}`);
		console.log(`Checkout URL:\n${challenge.methodDetails.checkout_url}`);
		await waitForPayment();

		return { pay: true };
	},
});

console.log(`${response.status} ${response.statusText}`);

if (response.ok) {
	console.log(await response.json());
}

if (receipt) {
	console.log("Receipt claims:", receipt);
}

if (receiptJws) {
	console.log(`Receipt JWS: ${receiptJws}`);
}
