import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const DM_ABI = [
  "function resolveDuel(uint256 duelId) external",
  "function getDuel(uint256) view returns (address agentA, address agentB, uint256 stake, uint256 startTime, uint256 endTime, uint8 state, address winner, bool agentASubmitted, bool agentBSubmitted, uint256 createdAt)",
  "function getLivePnL(uint256) view returns (int256 pnlA, int256 pnlB, uint256 updatedA, uint256 updatedB)",
];

async function main() {
  const DUEL_ID = Number(process.argv[2] || "29");
  const provider = new ethers.JsonRpcProvider("https://testnet.coti.io/rpc");
  const owner = new ethers.Wallet(process.env.SIGNING_KEYS!, provider);
  const dm = new ethers.Contract(process.env.DUEL_MANAGER_ADDRESS!, DM_ABI, owner);
  
  const [duel, pnl] = await Promise.all([dm.getDuel(DUEL_ID), dm.getLivePnL(DUEL_ID)]);
  console.log(`Duel #${DUEL_ID}: state=${Number(duel.state)} | pnlA=${Number(pnl.pnlA)}bps | pnlB=${Number(pnl.pnlB)}bps`);
  
  if (Number(duel.state) !== 1) { console.log("Not active — skipping"); return; }
  
  const endTime = Number(duel.endTime);
  const now = Math.floor(Date.now() / 1000);
  if (now < endTime) {
    console.log(`Still ${endTime - now}s to go — cannot resolve yet`);
    return;
  }
  
  console.log("Resolving...");
  const tx = await dm.resolveDuel(DUEL_ID, { gasLimit: 500_000n });
  const rc = await tx.wait();
  
  const fresh = await dm.getDuel(DUEL_ID);
  console.log(`✅ Resolved! Winner: ${fresh.winner}`);
  console.log(`   agentA: ${fresh.agentA}`);
  console.log(`   agentB: ${fresh.agentB}`);
  if (fresh.winner === ethers.ZeroAddress) console.log("🤝 No contest — neither agent reported, both stakes refunded");
  else if (fresh.winner.toLowerCase() === fresh.agentA.toLowerCase()) console.log("🏆 agentA (owner) wins");
  else console.log("🏆 agentB (renter) wins");
}

main().catch(e => { console.error(e.message); process.exit(1); });
