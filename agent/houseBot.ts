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
import { startLivePrices, currentPrices } from "./livePrices";
import { nonceManagerFor, withNonceRetry } from "./nonces";
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
/**
 * How often the house bot republishes.
 *
 * It matched the agent's old thirty seconds, which made both curves step rather
 * than move. The transaction is the floor — four to eight seconds on COTI — so
 * eight is close to as often as the chain will take it.
 */
const TICK_MS = Number(process.env.UPDATE_INTERVAL_MS || 3_000);

/**
 * How often the strategy sees a new price point.
 *
 * Separate from the publish interval, and it has to be. The roster is tuned in
 * ticks — Blitz reads two, Drift six, Sentinel nine — so shortening the loop to
 * three seconds quietly redefined every one of them: a two-tick lookback went
 * from a minute of market to six seconds, which contains nothing, and Blitz sat
 * at 0.00% for a whole duel without a single trade. Publishing got faster and
 * the bots stopped playing.
 *
 * Ten seconds keeps the tuning meaning what it meant while still fitting a whole
 * duel: the shortest is two minutes, which at twenty seconds was six points —
 * fewer than the longest window in the roster needs to produce its first number.
 * Marks and batches stay fast; the curve moves because the position is marked to
 * market, not because the strategy was asked again.
 */
const STRATEGY_TICK_MS = Number(process.env.STRATEGY_INTERVAL_MS || 10_000);

const DUEL_ABI = [
  "event DuelCreated(uint256 indexed duelId, address indexed agentA, uint256 stake, uint256 duration)",
  "function getDuel(uint256) view returns (address,address,uint256,uint256,uint256,uint8,address,bool,bool,uint256)",
  "function joinDuel(uint256) payable",
  "function updateLivePnL(uint256 duelId, int256 pnlBps)",
  "function updateLivePnLBatch(uint256 duelId, int256[] pnlBps, uint32[] ageMs)",
  "function duelCount() view returns (uint256)",
];

const log = (m: string) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const busy = new Set<string>();

async function play(duelId: bigint, wallet: ethers.Wallet) {
  // One sequence per wallet — see nonces.ts. A manager per duel gave two
  // concurrent duels the same nonce and silently dropped one of the updates.
  const dm = new ethers.Contract(DM_ADDR, DUEL_ABI, nonceManagerFor(wallet));

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
    // Retried once on a nonce fault: the local counter drifts whenever the RPC
    // goes away for a while, and a challenge nobody joins is the most visible
    // failure this bot has.
    await withNonceRetry(wallet, async () =>
      (await dm.joinDuel(duelId, { value: stake, gasLimit: 3_000_000n })).wait(),
    );
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
  // Same spacing the loop will feed it, so its window means what it says.
  const warm = await warmUpStrategy(strategy, 14, STRATEGY_TICK_MS);
  if (!warm.points) log(`duel ${duelId} — starting cold (${warm.error ?? "unknown"})`);

  let lastReported: number | null = null;

  /*
    Mark this side between transactions, so both curves move at the same rate.

    The agent server marks its own side in-process; this one is a separate
    daemon, so it posts over the local HTTP the page is already connected to.
    Nothing here is authoritative — what settles is what was published on-chain.
    A failed post costs a frame, so it is not retried and not awaited.
  */
  const AGENT_FEED = process.env.AGENT_SERVER_URL || "http://localhost:3001";
  const stopPrices = startLivePrices();
  const buffer: { bps: number; at: number }[] = [];

  const marker = setInterval(() => {
    const live = currentPrices();
    if (!live) return;
    const marked = scoreBps(
      strategy.calculatePnLBps({ ...(live as any), timestamp: Date.now() }).pnlBpsExact,
    );
    buffer.push({ bps: marked, at: Date.now() });

    // Straight to the page as well, which is what moves the line between
    // batches. This bot is its own process, so it goes over the local HTTP the
    // page is already connected to rather than onto a feed it cannot reach.
    fetch(`${AGENT_FEED}/agent/duel/${duelId}/mark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side: "B", pnlBps: marked }),
    }).catch(() => { /* the page simply misses a frame */ });
  }, 250);

  const stopMarking = () => {
    clearInterval(marker);
    stopPrices();
  };

  let lastStrategyTick = 0;

  while (Date.now() < endTime) {
    const prices = await fetchPrices();

    // The strategy only sees a point every STRATEGY_TICK_MS, so its lookbacks
    // still cover the span they were tuned for.
    if (Date.now() - lastStrategyTick >= STRATEGY_TICK_MS) {
      lastStrategyTick = Date.now();
      strategy.addPriceData(prices);
      for (const t of strategy.computeTrades()) {
        strategy.executeTrade(t.asset, t.side, t.sizePercent, prices[t.asset as keyof PriceData] as number);
      }
    }

    // Scored on a notional position — see notional.ts. Both sides go through it.
    const publicPnlBps = scoreBps(strategy.calculatePnLBps(prices).pnlBpsExact);
    try {
      /*
        Sent, not awaited.

        A COTI block is about six seconds and a receipt takes far longer — this
        loop logged 37 seconds between ticks with TICK_MS at 8000, because
        `.wait()` was the real interval. The nonce is managed locally (see the
        signer below) so several updates can be in flight in order, and "last
        value wins" still means the last one sent.
      */
      // The whole run since the last publish, in one transaction. Sixteen points
      // for the cost of one, and the shape of the race ends up in the event log
      // instead of only in whatever a server chose to stream.
      const run = buffer.splice(0, buffer.length).slice(-64);
      const points = run.length ? run : [{ bps: publicPnlBps, at: Date.now() }];
      const sentAt = Date.now();

      const tx = await withNonceRetry(wallet, () =>
        dm.updateLivePnLBatch(
          duelId,
          points.map((p) => BigInt(p.bps)),
          points.map((p) => Math.max(0, Math.min(0xffffffff, sentAt - p.at))),
          { gasLimit: 900_000n },
        ),
      );
      lastReported = points[points.length - 1].bps;
      log(`duel ${duelId} — ${(lastReported / 100).toFixed(2)}% (${points.length} pts)`);
      tx.wait().catch(() => { /* a lost update is replaced by the next one */ });
    } catch {
      if (Date.now() >= endTime) break;  // submissions closed, expected
    }

    const left = endTime - Date.now();
    if (left <= 1000) break;
    await sleep(Math.min(TICK_MS, left - 500));
  }

  stopMarking();

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
  // ethers polls logs every 4s by default, and a challenge sat unanswered for
  // that long on top of the two transactions it already costs — fifteen seconds
  // from "create" to "joined", for an opponent the platform is supposed to
  // provide instantly.
  provider.pollingInterval = 800;
  const wallet = new ethers.Wallet(KEY, provider);
  const dm = new ethers.Contract(DM_ADDR, DUEL_ABI, provider);

  log(`house bot ready — ${wallet.address.slice(0, 10)}…`);
  log(`  joins after ${GRACE_MS / 1000}s, up to ${ethers.formatEther(MAX_STAKE)} COTI`);

  // Logging here rather than at each caller. Both the event listener and the
  // duelCount poll see a new duel, so announcing it before de-duplicating
  // printed every challenge twice.
  const consider = (duelId: bigint, from: string) => {
    const k = duelId.toString();
    if (busy.has(k)) return;
    busy.add(k);
    log(`duel ${duelId} — challenge seen from ${from.slice(0, 10)}…`);
    play(duelId, wallet)
      .catch((e) => log(`duel ${duelId} — ${(e as Error).message?.slice(0, 70)}`))
      .finally(() => busy.delete(k));
  };

  dm.on("DuelCreated", (duelId: bigint, agentA: string) => {
    if (agentA.toLowerCase() === wallet.address.toLowerCase()) return;
    consider(duelId, agentA);
  });

  /**
   * Watch the counter too, not only the log.
   *
   * Log delivery on COTI goes through a filter the provider has to poll, and it
   * arrives after the block does. duelCount() is one eth_call and answers as
   * soon as the block exists, so this usually sees a new duel first; the event
   * listener above stays because it carries agentA without a second read. Both
   * funnel into consider(), which de-duplicates.
   */
  let seen = Number(await dm.duelCount());
  setInterval(async () => {
    try {
      const count = Number(await dm.duelCount());
      for (let id = seen + 1; id <= count; id++) {
        const duel = await dm.getDuel(id);
        if (String(duel[0]).toLowerCase() === wallet.address.toLowerCase()) continue;
        if (Number(duel[5]) !== 0) continue;
        consider(BigInt(id), String(duel[0]));
      }
      seen = Math.max(seen, count);
    } catch { /* a missed poll is picked up by the next one */ }
  }, 700);

  // Anything already waiting when the bot starts deserves an opponent too.
  const current = await provider.getBlockNumber();
  for (const ev of await dm.queryFilter(dm.filters.DuelCreated(), Math.max(0, current - 500))) {
    if (!("args" in ev)) continue;
    const [duelId, agentA] = (ev as ethers.EventLog).args as unknown as [bigint, string];
    if (String(agentA).toLowerCase() === wallet.address.toLowerCase()) continue;
    if (Number((await dm.getDuel(duelId))[5]) !== 0) continue;
    log(`duel ${duelId} — still open from before, taking it`);
    consider(duelId, String(agentA));
  }

  await new Promise(() => {});
}

main().catch((e) => { console.error(e); process.exit(1); });
