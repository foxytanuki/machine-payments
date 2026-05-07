import { createClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempoTestnet } from "viem/chains";
import { Actions } from "viem/tempo";

function getAccount() {
  const privateKey = process.env.MPPX_PRIVATE_KEY;
  if (privateKey === undefined || !privateKey.startsWith("0x")) {
    throw new Error(
      "MPPX_PRIVATE_KEY environment variable must be set to a 0x-prefixed private key",
    );
  }

  return privateKeyToAccount(privateKey as `0x${string}`);
}

const command = process.argv[2] ?? "address";
const account = getAccount();

if (command === "address") {
  console.log(account.address);
} else if (command === "fund") {
  console.log(`Funding ${account.address} on ${tempoTestnet.name}`);
  const client = createClient({ chain: tempoTestnet, transport: http() });
  const hashes = await Actions.faucet.fund(client, { account });
  console.log(JSON.stringify({ address: account.address, hashes }, null, 2));
} else {
  throw new Error(`Unknown wallet command: ${command}`);
}
