/**
 * Resolve a duel once both agents have submitted their encrypted PnL.
 * Anyone can call this — trustless resolution via Garbled Circuits.
 *
 * Usage: DUEL_ID=42 npx hardhat run scripts/resolve.ts --network coti_testnet
 */
import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const duelId = process.env.DUEL_ID;
  if (!duelId) {
    console.error("Set DUEL_ID env var");
    process.exit(1);
  }

  const address = process.env.DUEL_MANAGER_ADDRESS!;
  const [signer] = await ethers.getSigners();

  console.log(`Resolving duel #${duelId} as ${signer.address}`);

  const DuelManager = await ethers.getContractAt("DuelManager", address, signer);

  // Check state first
  const duelData = await DuelManager.getDuel(duelId);
  const state = Number(duelData[5]);

  if (state !== 2) {
    console.error(`Duel state is ${state} (need 2=PendingResolution)`);
    process.exit(1);
  }

  if (!duelData[7] || !duelData[8]) {
    console.error("Not both agents have submitted PnL yet");
    process.exit(1);
  }

  console.log("Both agents submitted. Calling MpcCore.gt() via Garbled Circuits...");

  const tx = await DuelManager.resolveDuel(duelId);
  const receipt = await tx.wait();

  const resolvedEvent = receipt?.logs.find((log: { topics: string[] }) =>
    log.topics[0] === ethers.id("DuelResolved(uint256,address,uint256)")
  );

  if (resolvedEvent) {
    const iface = DuelManager.interface;
    const parsed = iface.parseLog({ topics: resolvedEvent.topics as string[], data: resolvedEvent.data });
    const winner = parsed?.args[1];
    const prize = ethers.formatEther(parsed?.args[2]);
    console.log(`\n✅ Duel resolved!`);
    console.log(`   Winner: ${winner}`);
    console.log(`   Prize: ${prize} COTI`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
