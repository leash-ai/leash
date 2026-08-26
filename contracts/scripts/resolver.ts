/**
 * resolver.ts — resolve duels the moment they are resolvable.
 *
 * A contract cannot run itself. Nothing happens at endTime unless somebody sends
 * a transaction, so a finished duel sits Active, holding both stakes, until one
 * does. The contract is built for exactly this: resolveDuel is permissionless
 * and pays RESOLVER_FEE_BPS of the pot to whoever calls it. The role existed and
 * nobody filled it, which is why duels needed a button.
 *
 * This fills it. Run it beside the agents and duels settle on their own; the
 * button in the UI stays as the manual path for anyone who wants the bonus.
 *
 *   npx ts-node scripts/resolver.ts            # poll every 15s
 *   npx ts-node scripts/resolver.ts 5          # poll every 5s
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
dotenv.config();

const RPC = process.env.COTI_RPC || "https://testnet.coti.io/rpc";
const POLL_MS = Math.max(3, Number(process.argv[2] || 15)) * 1000;

const artifact = (n: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, `../artifacts/contracts/${n}.sol/${n}.json`), "utf8"));

const stamp = () => new Date().toTimeString().slice(0, 8);
const log = (m: string) => console.log(`[${stamp()}] ${m}`);

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.SIGNING_KEYS!.split(",")[0], provider);
  const dm = new ethers.Contract(process.env.DUEL_MANAGER_ADDRESS!, artifact("TestDuelManager").abi, wallet);
  const mkt = new ethers.Contract(process.env.AGENT_MARKETPLACE_ADDRESS!, artifact("AgentMarketplace").abi, wallet);

  log(`resolver started — ${wallet.address.slice(0, 10)}… polling every ${POLL_MS / 1000}s`);
  log(`  duels ${await dm.getAddress()}`);

  // Only look at duels that could still need work. Everything below this has
  // been resolved already and rechecking it every tick costs a call per duel.
  let floor = 1;

  for (;;) {
    try {
      const count = Number(await dm.duelCount());
      const now = Math.floor(Date.now() / 1000);
      let lowestUnresolved = count + 1;

      for (let id = floor; id <= count; id++) {
        const d = await dm.getDuel(id);
        const state = Number(d[5]);
        if (state === 2) continue;              // done
        lowestUnresolved = Math.min(lowestUnresolved, id);
        if (state !== 1) continue;              // still Open, nobody joined

        const closesAt = Number((await dm.getFinalPnLStatus(id))[2]);
        if (now < closesAt) continue;           // window still open

        try {
          await (await dm.resolveDuel(id, { gasLimit: 5_000_000n })).wait();
          const after = await dm.getDuel(id);
          const w = after[6] as string;
          log(w === ethers.ZeroAddress
            ? `duel ${id} → no contest, both stakes refunded`
            : `duel ${id} → winner ${w.slice(0, 10)}…`);
        } catch (e) {
          log(`duel ${id} → resolve failed: ${(e as Error).message?.slice(0, 70)}`);
        }
      }
      floor = Math.max(1, lowestUnresolved);

      // Settling a rental is what returns the renter's stake and records the
      // fight, so a resolved duel is only half the job.
      const rentals = Number(await mkt.rentalCount());
      for (let id = 1; id <= rentals; id++) {
        const r = await mkt.rentals(id);
        if (r[8] as boolean) continue;
        if (Number((await dm.getDuel(r[2]))[5]) !== 2) continue;
        try {
          await (await mkt.settleRental(id, { gasLimit: 5_000_000n })).wait();
          log(`rental ${id} → settled`);
        } catch { /* retried next tick */ }
      }
    } catch (e) {
      log(`poll failed: ${(e as Error).message?.slice(0, 70)}`);
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
