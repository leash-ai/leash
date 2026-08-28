/**
 * houseBot.ts — makes sure a duel always has an opponent.
 *
 * Creating a duel and waiting for a stranger is the worst version of this
 * product: the clock does not start, nothing moves, and the page says "waiting
 * for opponent" until you give up. A house bot removes that failure mode — you
 * always get a race, and a human who turns up first still takes precedence
 * because the bot waits before joining.
 *
 * It runs rules, not a model. momentum, mean-reversion and market-making are
 * deterministic strategies over the price feed, so the bot needs no API key, has
 * no latency to speak of and cannot fail because a provider is down. Which
 * strategy it picks rotates per duel, so repeat matches are not repeat results.
 *
 * Which opponent you draw is random — see strategies/roster.ts. Knowing who you
 * face lets you tune against them, and a duel where the counter is known is not
 * much of a duel.
 *
 *   npx ts-node houseBot.ts
 *
 * Env: HOUSE_BOT_GRACE_MS  wait before joining, ms      (default 0 — immediate)
 *      HOUSE_BOT_MAX_STAKE most it will match, in COTI  (default 0.5)
 */
import { ethers } from "ethers";
import dotenv from "dotenv";
import { PriceData } from "./strategies/momentum";
import { drawOpponent } from "./strategies/roster";
import { scoreBps } from "./notional";
import { warmUpStrategy } from "./strategies/warmup";
import { fetchPrices } from "./marketData";
import { cotiWallet, submitFinalPnL } from "./coti/settlement";

dotenv.config();

const RPC = process.env.COTI_RPC || "https://testnet.coti.io/rpc";
const DM_ADDR = process.env.DUEL_MANAGER_ADDRESS!;
const KEY = process.env.HOUSE_BOT_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY!;
// Zero by default: a challenge should start the moment it is made. Waiting was
// meant to leave room for a human to take the match first, but an empty page for
// twenty seconds is a worse outcome than a bot answering fast.
const GRACE_MS = Number(process.env.HOUSE_BOT_GRACE_MS ?? 0);
const MAX_STAKE = ethers.parseEther(process.env.HOUSE_BOT_MAX_STAKE || "0.5");
const TICK_MS = Number(process.env.UPDATE_INTERVAL_MS || 30_000);

const DUEL_ABI = [
  "event DuelCreated(uint256 indexed duelId, address indexed agentA, uint256 stake, uint256 duration)",
  "function getDuel(uint256) view returns (address,address,uint256,uint256,uint256,uint8,address,bool,bool,uint256)",
  "function joinDuel(uint256) payable",
  "function updateLivePnL(uint256 duelId, int256 pnlBps)",
];

const log = (m: string) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const busy = new Set<string>();

async function play(duelId: bigint, wallet: ethers.Wallet) {
  const dm = new ethers.Contract(DM_ADDR, DUEL_ABI, wallet);

  // Only if a grace period was asked for; by default there is none.
  if (GRACE_MS > 0) await sleep(GRACE_MS);
  let d = await dm.getDuel(duelId);
  if (Number(d[5]) !== 0) { log(`duel ${duelId} — already taken, leaving it`); return; }

  const stake = BigInt(d[2]);
  if (stake > MAX_STAKE) {
    log(`duel ${duelId} — stake ${ethers.formatEther(stake)} COTI above the limit, skipping`);
    return;
  }
  if ((d[0] as string).toLowerCase() === wallet.address.toLowerCase()) return;

  try {
    await (await dm.joinDuel(duelId, { value: stake, gasLimit: 3_000_000n })).wait();
  } catch (e) {
    log(`duel ${duelId} — join failed: ${(e as Error).message?.slice(0, 70)}`);
    return;
  }

  // endTime only becomes a timestamp once someone joins.
  d = await dm.getDuel(duelId);
  const startTime = Number(d[3]);
  const endTime = Number(d[4]) * 1000;

  // Derived from what the chain stores, so the duel page names the same bot.
  const opponent = drawOpponent(Number(duelId), startTime);
  log(`duel ${duelId} — joined for ${ethers.formatEther(stake)} COTI`);
  log(`duel ${duelId} — you drew ${opponent.name}: ${opponent.style}`);

  const strategy = opponent.build();
  const warm = await warmUpStrategy(strategy);
  if (!warm.points) log(`duel ${duelId} — starting cold (${warm.error ?? "unknown"})`);

  let lastReported: number | null = null;

  while (Date.now() < endTime) {
    const prices = await fetchPrices();
    strategy.addPriceData(prices);
    for (const t of strategy.computeTrades()) {
      strategy.executeTrade(t.asset, t.side, t.sizePercent, prices[t.asset as keyof PriceData] as number);
    }

    // Scored on a notional position — see notional.ts. Both sides go through it.
    const publicPnlBps = scoreBps(strategy.calculatePnLBps(prices).publicPnlBps);
    try {
      await (await dm.updateLivePnL(duelId, publicPnlBps, { gasLimit: 300_000n })).wait();
      lastReported = publicPnlBps;
      log(`duel ${duelId} — ${(publicPnlBps / 100).toFixed(2)}%`);
    } catch {
      if (Date.now() >= endTime) break;  // submissions closed, expected
    }

    const left = endTime - Date.now();
    if (left <= 1000) break;
    await sleep(Math.min(TICK_MS, left - 500));
  }

  if (lastReported === null) { log(`duel ${duelId} — nothing landed on-chain`); return; }

  // Settling is optional since the fallback decides on public scores, but doing
  // it is what lets the garbled circuit run.
  try {
    // Its own AES key, derived on first use — AES_KEY belongs to the agent
    // wallet, and handing it a key that is not its own is why settlement used to
    // revert here. The duel still resolves either way: the fallback decides on
    // public scores. Settling is what lets the garbled circuit run.
    const signer = await cotiWallet(KEY, new ethers.JsonRpcProvider(RPC), process.env.HOUSE_BOT_AES_KEY);
    await submitFinalPnL(signer, DM_ADDR, duelId, lastReported);
    log(`duel ${duelId} — settled at ${(lastReported / 100).toFixed(2)}%`);
  } catch (e) {
    log(`duel ${duelId} — settlement skipped: ${(e as Error).message?.slice(0, 60)}`);
  }
}

async function main() {
  if (!DM_ADDR || !KEY) {
    console.error("Missing DUEL_MANAGER_ADDRESS or a key (HOUSE_BOT_PRIVATE_KEY / AGENT_PRIVATE_KEY).");
    process.exit(1);
  }

  // polling: true — COTI's RPC drops idle filters and the subscription dies with
  // them, which for a bot that exists to answer challenges means silently
  // answering none.
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { polling: true });
  const wallet = new ethers.Wallet(KEY, provider);
  const dm = new ethers.Contract(DM_ADDR, DUEL_ABI, provider);

  log(`house bot ready — ${wallet.address.slice(0, 10)}…`);
  log(`  joins after ${GRACE_MS / 1000}s, up to ${ethers.formatEther(MAX_STAKE)} COTI`);

  const consider = (duelId: bigint) => {
    const k = duelId.toString();
    if (busy.has(k)) return;
    busy.add(k);
    play(duelId, wallet)
      .catch((e) => log(`duel ${duelId} — ${(e as Error).message?.slice(0, 70)}`))
      .finally(() => busy.delete(k));
  };

  dm.on("DuelCreated", (duelId: bigint, agentA: string) => {
    if (agentA.toLowerCase() === wallet.address.toLowerCase()) return;
    log(`duel ${duelId} — challenge seen from ${agentA.slice(0, 10)}…`);
    consider(duelId);
  });

  // Anything already waiting when the bot starts deserves an opponent too.
  const current = await provider.getBlockNumber();
  for (const ev of await dm.queryFilter(dm.filters.DuelCreated(), Math.max(0, current - 500))) {
    if (!("args" in ev)) continue;
    const [duelId, agentA] = (ev as ethers.EventLog).args as unknown as [bigint, string];
    if (String(agentA).toLowerCase() === wallet.address.toLowerCase()) continue;
    if (Number((await dm.getDuel(duelId))[5]) !== 0) continue;
    log(`duel ${duelId} — still open from before, taking it`);
    consider(duelId);
  }

  await new Promise(() => {});
}

main().catch((e) => { console.error(e); process.exit(1); });
