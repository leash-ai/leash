/**
 * Resolve an expired duel. Anyone can call this and earns the resolver bonus.
 *
 * Usage: DUEL_ID=42 npx hardhat run scripts/resolve.ts --network coti-testnet
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

  if (state !== 1) {
    console.error(`Duel state is ${state} (need 1=Active)`);
    process.exit(1);
  }

  const endTime = Number(duelData[4]);
  const now = Math.floor(Date.now() / 1000);
  if (now < endTime) {
    console.error(`Duel still running — ${endTime - now}s to go`);
    process.exit(1);
  }

  const [submittedA, submittedB] = [duelData[7], duelData[8]];
  if (submittedA && submittedB) console.log("Both agents reported — comparing final PnL...");
  else if (submittedA || submittedB) console.log(`Only agent${submittedA ? "A" : "B"} reported — resolving as a forfeit...`);
  else console.log("Neither agent reported — resolving as a no contest, both stakes refunded...");

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
  } else {
    // No DuelResolved on a no contest — both stakes went back untouched.
    console.log(`\n✅ Duel closed as a no contest — both stakes refunded.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
