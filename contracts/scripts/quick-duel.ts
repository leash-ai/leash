import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const DM_ABI = [
  "function createDuel(uint256 duration) external payable returns (uint256)",
  "function joinDuel(uint256 duelId) external payable",
  "function duelCount() view returns (uint256)",
  "event DuelCreated(uint256 indexed duelId, address indexed agentA, uint256 stake, uint256 duration)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.COTI_RPC || "https://testnet.coti.io/rpc");
  const owner = new ethers.Wallet(process.env.SIGNING_KEYS!, provider);
  const RENTER_KEY = ethers.keccak256(ethers.toUtf8Bytes(process.env.SIGNING_KEYS! + "leash-renter-v1"));
  const renter = new ethers.Wallet(RENTER_KEY, provider);
  const dmOwner = new ethers.Contract(process.env.DUEL_MANAGER_ADDRESS!, DM_ABI, owner);
  const dmRenter = new ethers.Contract(process.env.DUEL_MANAGER_ADDRESS!, DM_ABI, renter);

  const STAKE = ethers.parseEther("0.1");
  const DURATION = 120n; // 2 minutes

  console.log("Creating 2-min duel (0.1 COTI stake)...");
  const tx1 = await dmOwner.createDuel(DURATION, { value: STAKE, gasLimit: 500_000n });
  const rc1 = await tx1.wait();
  const log = rc1?.logs.find((l: any) => l.topics[0] === ethers.id("DuelCreated(uint256,address,uint256,uint256)"));
  const duelId = log ? Number(BigInt(log.topics[1])) : Number(await dmOwner.duelCount());
  console.log(`✅ Duel #${duelId} created`);

  console.log(`Renter joining duel #${duelId}...`);
  const tx2 = await dmRenter.joinDuel(duelId, { value: STAKE, gasLimit: 500_000n });
  await tx2.wait();
  console.log(`✅ Renter joined — duel is now ACTIVE`);
  console.log(`DUEL_ID=${duelId}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
