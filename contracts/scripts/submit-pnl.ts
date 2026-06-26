import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const DM_ABI = [
  "function updateLivePnL(uint256 duelId, int256 pnlBps) external",
];

async function send(label: string, fn: () => Promise<any>) {
  const tx = await fn();
  const rc = await tx.wait();
  console.log(`${label}: ${rc?.hash?.slice(0, 20)}… status=${rc?.status}`);
  return rc;
}

async function main() {
  const provider = new ethers.JsonRpcProvider("https://testnet.coti.io/rpc");
  const SIGNING_KEY = process.env.SIGNING_KEYS!;
  const owner = new ethers.Wallet(SIGNING_KEY, provider);
  const RENTER_KEY = ethers.keccak256(ethers.toUtf8Bytes(SIGNING_KEY + "leash-renter-v1"));
  const renter = new ethers.Wallet(RENTER_KEY, provider);

  const dmOwner = new ethers.Contract(process.env.DUEL_MANAGER_ADDRESS!, DM_ABI, owner);
  const dmRenter = new ethers.Contract(process.env.DUEL_MANAGER_ADDRESS!, DM_ABI, renter);

  const DUEL_ID = 20;

  // agentA (owner) = +3.14%
  await send("agentA pnl +314bps", () =>
    dmOwner.updateLivePnL(DUEL_ID, 314n, { gasLimit: 200_000n })
  );

  // agentB (renter) = +1.87%
  await send("agentB pnl +187bps", () =>
    dmRenter.updateLivePnL(DUEL_ID, 187n, { gasLimit: 200_000n })
  );

  console.log("Done — agentA leading with +3.14% vs +1.87%");
}

main().catch(console.error);
