import { Mppx, tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

const privateKey = process.env.MPPX_PRIVATE_KEY;
if (!privateKey?.startsWith("0x")) {
  throw new Error("MPPX_PRIVATE_KEY environment variable must be set to a 0x-prefixed private key");
}

const url = process.argv[2] ?? "http://localhost:4242/paid";

Mppx.create({
  methods: [
    tempo({
      account: privateKeyToAccount(privateKey as `0x${string}`),
    }),
  ],
});

const response = await fetch(url);
console.log(`${response.status} ${response.statusText}`);
console.log(await response.text());
