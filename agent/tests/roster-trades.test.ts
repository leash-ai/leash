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
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ROSTER } from "../strategies/roster";
import { PriceData } from "../strategies/momentum";

/** A duel: 30 points, ±0.1% overall, with the small reversals a market has. */
function duelPrices(seed: number): PriceData[] {
  let rng = seed;
  const next = () => {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    return rng / 2147483648 - 0.5;
  };

  const base = { BTC: 78000, ETH: 2450, SOL: 103, BNB: 690, AVAX: 7.3 };
  const drift = { BTC: 0, ETH: 0, SOL: 0, BNB: 0, AVAX: 0 } as Record<string, number>;
  const out: PriceData[] = [];

  for (let i = 0; i < 30; i++) {
    for (const asset of Object.keys(base)) {
      // ~0.02% a step, so about 0.1% across the duel once the walk cancels out.
      drift[asset] += next() * 0.0004;
    }
    out.push({
      BTC: base.BTC * (1 + drift.BTC),
      ETH: base.ETH * (1 + drift.ETH),
      SOL: base.SOL * (1 + drift.SOL),
      timestamp: Date.now() + i * 20_000,
    } as PriceData);
  }
  return out;
}

for (const opponent of ROSTER) {
  test(`${opponent.name} opens a position inside a duel`, () => {
    // Several walks: one bot sitting out one particular market is fair, sitting
    // out every one of them is the bug this exists to catch.
    const traded = [1, 7, 42, 1234, 99991].some((seed) => {
      const strategy = opponent.build();
      let opened = 0;
      for (const prices of duelPrices(seed)) {
        strategy.addPriceData(prices);
        for (const t of strategy.computeTrades()) {
          strategy.executeTrade(t.asset, t.side, t.sizePercent, prices[t.asset as keyof PriceData] as number);
          opened += 1;
        }
      }
      return opened > 0;
    });

    assert.ok(traded, `${opponent.name} never traded — its thresholds cannot be reached in a duel`);
  });
}
