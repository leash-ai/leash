import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const SIGNING_KEY = process.env.SIGNING_KEYS!;
const DM_ADDR = process.env.DUEL_MANAGER_ADDRESS!;
const DUEL_ID = Number(process.argv[2] || "20");

const DM_ABI = [
  "function joinDuel(uint256 duelId) external payable",
  "function getDuel(uint256) view returns (address agentA, address agentB, uint256 stake, uint256 startTime, uint256 endTime, uint8 state, address winner, bool agentASubmitted, bool agentBSubmitted, uint256 createdAt)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider("https://testnet.coti.io/rpc");
  const RENTER_KEY = ethers.keccak256(ethers.toUtf8Bytes(SIGNING_KEY + "leash-renter-v1"));
  const renter = new ethers.Wallet(RENTER_KEY, provider);

  const bal = await provider.getBalance(renter.address);
  console.log("renter:", renter.address);
  console.log("balance:", ethers.formatEther(bal), "COTI");

  const dm = new ethers.Contract(DM_ADDR, DM_ABI, renter);
  const duel = await dm.getDuel(DUEL_ID);
  console.log("stake:", ethers.formatEther(duel.stake), "COTI");
  console.log("state:", duel.state.toString(), "(0=Open, 1=Active, 2=Resolved)");
  console.log("agentA:", duel.agentA);

  if (Number(duel.state) !== 0) {
    console.log("Duel not open — cannot join");
    return;
  }

  const stake = duel.stake;
  if (bal < stake + ethers.parseEther("0.01")) {
    console.log("Insufficient balance to join + gas");
    return;
  }

  console.log("\nJoining duel", DUEL_ID, "...");
  const tx = await dm.joinDuel(DUEL_ID, { value: stake, gasLimit: 500_000n });
  console.log("tx:", tx.hash);
  const rc = await tx.wait();
  console.log("status:", rc?.status === 1 ? "SUCCESS" : "FAILED");
}

main().catch(console.error);
