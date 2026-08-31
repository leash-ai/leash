/**
 * Every house bot has to actually open a position.
 *
 * A bot that never trades publishes 0.00% for the whole duel, and from the
 * outside that is indistinguishable from a broken product — which is exactly
 * what it was taken for. It has gone wrong twice in the same direction: first
 * lookbacks off a daily chart, then thresholds off one. Both times the code
 * compiled, the tests passed and the bot sat out.
 *
 * So this runs the roster over a duel's worth of prices and fails any entry that
 * never opens a position. The walk is deliberately modest: a tenth of a percent
 * end to end, which is what these assets do in ten minutes. Tuning that only
 * works on a lively day is tuning that fails on the day it is demonstrated.
 *
 * The budget is the duel's, not a round number. A first pass handed every
 * strategy thirty points and passed, while Contrarian — which averages over
 * eight — was getting one point every twenty seconds in a two-minute duel and
 * never filled its window. It published 0.00% for the whole thing. A test that
 * does not model the clock will keep approving bots that have no time to play.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ROSTER } from "../strategies/roster";
import { PriceData } from "../strategies/momentum";

/** The shortest duel offered, which is the one a bot has to fit inside. */
const SHORTEST_DUEL_MS = 120_000;
/** Matches houseBot.ts STRATEGY_INTERVAL_MS. */
const STRATEGY_TICK_MS = 10_000;
/** Matches the default in warmUpStrategy. */
const WARM_UP_POINTS = 14;

const POINTS = WARM_UP_POINTS + Math.floor(SHORTEST_DUEL_MS / STRATEGY_TICK_MS);

/** A duel's worth of points, ±0.1% overall, with the reversals a market has. */
function duelPrices(seed: number): PriceData[] {
  let rng = seed;
  const next = () => {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    return rng / 2147483648 - 0.5;
  };

  const base = { BTC: 78000, ETH: 2450, SOL: 103, BNB: 690, AVAX: 7.3 };
  const drift = { BTC: 0, ETH: 0, SOL: 0, BNB: 0, AVAX: 0 } as Record<string, number>;
  const out: PriceData[] = [];

  for (let i = 0; i < POINTS; i++) {
    for (const asset of Object.keys(base)) {
      // ~0.02% a step, so about 0.1% across the duel once the walk cancels out.
      drift[asset] += next() * 0.0004;
    }
    out.push({
      BTC: base.BTC * (1 + drift.BTC),
      ETH: base.ETH * (1 + drift.ETH),
      SOL: base.SOL * (1 + drift.SOL),
      timestamp: Date.now() + i * STRATEGY_TICK_MS,
    } as PriceData);
  }
  return out;
}

/**
 * Trades, and when.
 *
 * Trading at all is not the bar. A bot whose window only fills near the end
 * spends the part of the duel people watch at a flat 0.00% and then twitches
 * once — which is what Contrarian did, and it looked exactly like a bot doing
 * nothing, because for the visible part of the duel it was.
 */
function firstTradeAt(opponent: (typeof ROSTER)[number], seed: number): number | null {
  const strategy = opponent.build();
  let index = 0;
  for (const prices of duelPrices(seed)) {
    strategy.addPriceData(prices);
    const trades = strategy.computeTrades();
    for (const t of trades) {
      strategy.executeTrade(t.asset, t.side, t.sizePercent, prices[t.asset as keyof PriceData] as number);
    }
    if (trades.length > 0) return index;
    index += 1;
  }
  return null;
}

// Several walks: one bot sitting out one particular market is fair, sitting out
// every one of them is the bug this exists to catch.
const SEEDS = [1, 7, 42, 1234, 99991];

for (const opponent of ROSTER) {
  test(`${opponent.name} opens a position inside a duel`, () => {
    const traded = SEEDS.some((seed) => firstTradeAt(opponent, seed) !== null);
    assert.ok(traded, `${opponent.name} never traded — its thresholds cannot be reached in a duel`);
  });

  test(`${opponent.name} is playing while the duel is still worth watching`, () => {
    // Warm-up fills the window before the clock starts, so the first half of the
    // live points is a fair bar: past that, the person watching has already
    // decided the bot is broken.
    const halfway = WARM_UP_POINTS + Math.floor((POINTS - WARM_UP_POINTS) / 2);
    const early = SEEDS.filter((seed) => {
      const at = firstTradeAt(opponent, seed);
      return at !== null && at <= halfway;
    });

    assert.ok(
      early.length >= 3,
      `${opponent.name} only got going early on ${early.length}/${SEEDS.length} duels — ` +
        `it spends the watchable half at 0.00%`,
    );
  });
}
