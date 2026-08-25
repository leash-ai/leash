/**
 * settle-stale.ts — resolve expired duels and settle finished rentals.
 *
 * Two things accumulate on a long-lived deployment and neither cleans itself up:
 *
 *   - A duel whose final window has closed still sits Active until somebody calls
 *     resolveDuel. Until then both stakes are held by the contract. Anyone may
 *     call it and earns RESOLVER_FEE_BPS of the pot for doing so, so this is not
 *     charity — it is just that nothing in the repo ever did it.
 *   - A rental stays unsettled until settleRental runs, which is what returns the
 *     renter's stake on a no-contest and records the fight against the agent.
 *
 * Read-only by default. Pass --execute to send transactions.
 *
 *   npx ts-node scripts/settle-stale.ts
 *   npx ts-node scripts/settle-stale.ts --execute
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
dotenv.config();

const RPC = process.env.COTI_RPC || "https://testnet.coti.io/rpc";
const DM_ADDR = process.env.DUEL_MANAGER_ADDRESS!;
const MKT_ADDR = process.env.AGENT_MARKETPLACE_ADDRESS!;
const EXECUTE = process.argv.includes("--execute");

const artifact = (n: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, `../artifacts/contracts/${n}.sol/${n}.json`), "utf8"));

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.SIGNING_KEYS!.split(",")[0], provider);
  const dm = new ethers.Contract(DM_ADDR, artifact("TestDuelManager").abi, wallet);
  const mkt = new ethers.Contract(MKT_ADDR, artifact("AgentMarketplace").abi, wallet);

  console.log(`\n  ${EXECUTE ? "EXECUTING" : "DRY RUN — pass --execute to send"}`);
  console.log(`  DuelManager  ${DM_ADDR}`);
  console.log(`  Marketplace  ${MKT_ADDR}\n`);

  const now = Math.floor(Date.now() / 1000);
  const duelCount = Number(await dm.duelCount());
  let resolvable = 0, resolved = 0, held = 0n;

  for (let id = 1; id <= duelCount; id++) {
    const d = await dm.getDuel(id);
    if (Number(d[5]) !== 1) continue;                      // not Active
    const closesAt = Number((await dm.getFinalPnLStatus(id))[2]);
    if (now < closesAt) continue;                          // still in its window
    resolvable++;
    held += BigInt(d[2]) * 2n;
    if (!EXECUTE) { console.log(`  duel ${id}: resolvable (window closed ${now - closesAt}s ago)`); continue; }
    try {
      await (await dm.resolveDuel(id, { gasLimit: 5_000_000n })).wait();
      const after = await dm.getDuel(id);
      const w = after[6] as string;
      console.log(`  duel ${id}: resolved → ${w === ethers.ZeroAddress ? "no contest, both refunded" : `winner ${w.slice(0, 10)}…`}`);
      resolved++;
    } catch (e) {
      console.log(`  duel ${id}: resolve failed — ${(e as Error).message?.slice(0, 60)}`);
    }
  }

  const rentalCount = Number(await mkt.rentalCount());
  let settleable = 0, settled = 0;

  for (let id = 1; id <= rentalCount; id++) {
    const r = await mkt.rentals(id);
    if (r[8] as boolean) continue;                         // already settled
    const d = await dm.getDuel(r[2]);
    if (Number(d[5]) !== 2) continue;                      // duel not resolved yet
    settleable++;
    if (!EXECUTE) { console.log(`  rental ${id}: settleable (duel ${r[2]} resolved)`); continue; }
    try {
      await (await mkt.settleRental(id, { gasLimit: 5_000_000n })).wait();
      console.log(`  rental ${id}: settled`);
      settled++;
    } catch (e) {
      console.log(`  rental ${id}: settle failed — ${(e as Error).message?.slice(0, 60)}`);
    }
  }

  console.log(`\n  duels resolvable: ${resolvable}${EXECUTE ? ` — resolved ${resolved}` : ""}`);
  console.log(`  stake held by unresolved duels: ${ethers.formatEther(held)} COTI`);
  console.log(`  rentals settleable: ${settleable}${EXECUTE ? ` — settled ${settled}` : ""}\n`);
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
