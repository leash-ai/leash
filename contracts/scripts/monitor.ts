/**
 * Monitor all active duels and print live PnL updates.
 *
 * Usage: npx hardhat run scripts/monitor.ts --network coti_testnet
 */
import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

const STATE_LABELS = ["Open", "Active", "PendingResolution", "Resolved"];

async function main() {
  const address = process.env.DUEL_MANAGER_ADDRESS!;
  const provider = ethers.provider;

  console.log(`\n🔍 Leash Monitor — watching ${address}\n`);

  const DuelManager = await ethers.getContractAt("DuelManager", address);
  const count = Number(await DuelManager.duelCount());

  // Print all active duels
  console.log(`Total duels: ${count}\n`);
  for (let i = 1; i <= count; i++) {
    const d = await DuelManager.getDuel(i);
    const state = Number(d[5]);
    if (state !== 1) continue; // Only show active

    const pnl = await DuelManager.getLivePnL(i);
    const endTime = new Date(Number(d[4]) * 1000);
    const remaining = Math.max(0, endTime.getTime() - Date.now());
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);

    console.log(`Duel #${i} [${STATE_LABELS[state]}]`);
    console.log(`  A: ${d[0].slice(0, 10)}... PnL: ${(Number(pnl[0]) / 100).toFixed(2)}%`);
    console.log(`  B: ${d[1].slice(0, 10)}... PnL: ${(Number(pnl[1]) / 100).toFixed(2)}%`);
    console.log(`  Ends in: ${hours}h ${mins}m\n`);
  }

  // Subscribe to events
  console.log("Listening for events...\n");

  DuelManager.on("DuelCreated", (duelId, agentA, stake, duration) => {
    console.log(`[NEW] Duel #${duelId} by ${agentA.slice(0, 10)}... | stake: ${ethers.formatEther(stake)} COTI | ${Number(duration) / 3600}h`);
  });

  DuelManager.on("DuelJoined", (duelId, agentB) => {
    console.log(`[JOIN] Duel #${duelId} joined by ${agentB.slice(0, 10)}... → started!`);
  });

  DuelManager.on("PnLUpdated", (duelId, agent, pnlBps) => {
    const sign = Number(pnlBps) >= 0 ? "+" : "";
    console.log(`[PNL] Duel #${duelId} | ${agent.slice(0, 10)}... → ${sign}${(Number(pnlBps) / 100).toFixed(2)}%`);
  });

  DuelManager.on("DuelResolved", (duelId, winner, prize) => {
    console.log(`[DONE] Duel #${duelId} | winner: ${winner.slice(0, 10)}... | prize: ${ethers.formatEther(prize)} COTI`);
  });

  // Keep alive
  await new Promise(() => {});
}

main().catch(console.error);
