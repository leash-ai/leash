/**
 * Strategy contract and PnL encoding.
 *
 * These cover the two failures that reached a deployment. The union of the three
 * strategies once intersected to `never` at executeTrade, so `ts-node agent.ts
 * run` could not start at all; and the encoded score has to equal
 * publicPnlBps + PNL_OFFSET exactly, because DuelManager pins the ciphertext to
 * the last public report and rejects anything else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MomentumStrategy, PriceData } from "../strategies/momentum";
import { MeanReversionStrategy } from "../strategies/meanReversion";
import { MarketMakerStrategy } from "../strategies/marketMaker";
import { Strategy, Side } from "../strategies/types";
import { PNL_OFFSET } from "../coti/settlement";
import { warmUpStrategy } from "../strategies/warmup";

const at = (i: number): PriceData => ({
  BTC: 70_000 + i * 350,
  ETH: 2_500 - i * 12,
  SOL: 90 + i * 1.5,
  timestamp: 1_700_000_000_000 + i * 30_000,
});

/** Every strategy, held at the shared interface type on purpose. */
function all(): { name: string; strategy: Strategy }[] {
  return [
    { name: "momentum", strategy: new MomentumStrategy(1000) },
    { name: "meanReversion", strategy: new MeanReversionStrategy() },
    { name: "marketMaker", strategy: new MarketMakerStrategy() },
  ];
}

test("all three satisfy the Strategy contract", () => {
  for (const { name, strategy } of all()) {
    for (const fn of ["addPriceData", "computeTrades", "executeTrade", "calculatePnLBps"]) {
      assert.equal(typeof (strategy as unknown as Record<string, unknown>)[fn], "function",
        `${name} is missing ${fn}`);
    }
  }
});

test("a Strategy-typed value can be driven end to end", () => {
  // The regression: with three divergent executeTrade signatures this line does
  // not compile, which is what stopped the agent starting.
  for (const { name, strategy } of all()) {
    for (let i = 0; i < 8; i++) strategy.addPriceData(at(i));
    const trades = strategy.computeTrades();
    for (const t of trades) {
      strategy.executeTrade(t.asset, t.side, t.sizePercent, at(8)[t.asset as keyof PriceData] as number);
    }
    assert.ok(Array.isArray(trades), `${name} did not return trades`);
  }
});

test("trades only ever use the shared long/short vocabulary", () => {
  const allowed: Side[] = ["long", "short"];
  for (const { name, strategy } of all()) {
    for (let i = 0; i < 8; i++) strategy.addPriceData(at(i));
    for (const t of strategy.computeTrades()) {
      assert.ok(allowed.includes(t.side), `${name} emitted side "${t.side}"`);
      assert.ok(t.sizePercent > 0 && t.sizePercent <= 100, `${name} sizePercent ${t.sizePercent}`);
    }
  }
});

test("gcEncoded is exactly publicPnlBps + PNL_OFFSET", () => {
  for (const { name, strategy } of all()) {
    for (let i = 0; i < 8; i++) strategy.addPriceData(at(i));
    for (const t of strategy.computeTrades()) {
      strategy.executeTrade(t.asset, t.side, t.sizePercent, at(8)[t.asset as keyof PriceData] as number);
    }
    // Several points, so a position that moves both ways is covered.
    for (const i of [9, 14, 20]) {
      const { publicPnlBps, gcEncoded } = strategy.calculatePnLBps(at(i));
      assert.equal(gcEncoded, publicPnlBps + PNL_OFFSET,
        `${name}: pin would reject — ${gcEncoded} != ${publicPnlBps} + ${PNL_OFFSET}`);
      assert.ok(Number.isInteger(publicPnlBps), `${name}: publicPnlBps must be an integer`);
    }
  }
});

test("reported PnL stays inside the bounds updateLivePnL enforces", () => {
  // DuelManager.PNL_MIN_BPS / PNL_MAX_BPS. Outside these, updateLivePnL reverts
  // and the agent silently reports nothing for that tick.
  const MIN = -100_000_000, MAX = 100_000_000;
  for (const { name, strategy } of all()) {
    for (let i = 0; i < 8; i++) strategy.addPriceData(at(i));
    for (const t of strategy.computeTrades()) {
      strategy.executeTrade(t.asset, t.side, t.sizePercent, at(8)[t.asset as keyof PriceData] as number);
    }
    const { publicPnlBps, gcEncoded } = strategy.calculatePnLBps(at(30));
    assert.ok(publicPnlBps >= MIN && publicPnlBps <= MAX, `${name}: ${publicPnlBps} out of range`);
    assert.ok(gcEncoded >= 0, `${name}: gcEncoded ${gcEncoded} would underflow uint64`);
  }
});

test("warm-up degrades to a cold start when history is unavailable", async () => {
  const realFetch = globalThis.fetch;
  const realCache = process.env.LEASH_PRICE_CACHE;
  // Point the shared cache at nothing. Otherwise a warm cache on the machine
  // answers before the stubbed fetch can, and this passes in CI while failing
  // locally — which is how it was found.
  process.env.LEASH_PRICE_CACHE = join(tmpdir(), "leash-test-cache-does-not-exist.json");
  globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
  try {
    const warm = await warmUpStrategy(new MomentumStrategy(1000), 5);
    assert.equal(warm.points, 0, "an unreachable price API must not throw, just seed nothing");
    assert.ok(warm.error, "and it must say why, or a rate limit is indistinguishable from a cold start");
  } finally {
    globalThis.fetch = realFetch;
    if (realCache === undefined) delete process.env.LEASH_PRICE_CACHE;
    else process.env.LEASH_PRICE_CACHE = realCache;
  }
});
