/**
 * A failed price fetch must not move the market.
 *
 * The fallback used to be a fixed price level, and CoinGecko's free tier
 * rate-limits mid-duel, so ticks alternated between the real price and a number
 * tens of percent away. A position opened at the real SOL was marked against the
 * placeholder on the next tick and a five-minute duel printed +11.33%, then
 * -0.08% once the feed came back. Both went on-chain, and settlement pins to the
 * last live score — so a rate limit could pick the winner.
 *
 * This is not a detail of one provider. Any feed fails sometimes; what matters is
 * that a missing observation scores as no movement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

const MODULE = join(__dirname, "../src/prices.ts");

/** Fresh module each time, since the held price is module state. */
function loadPrices() {
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE) as { fetchPrices: () => Promise<Record<string, number>> };
}

const ok = (body: unknown) =>
  async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const live = {
  bitcoin: { usd: 61234 },
  ethereum: { usd: 2456 },
  solana: { usd: 105.26 },
  binancecoin: { usd: 590 },
  "avalanche-2": { usd: 21 },
};

test("a failed fetch holds the last real prices", async () => {
  const { fetchPrices } = loadPrices();
  const original = globalThis.fetch;
  const quiet = console.warn;
  console.warn = () => {};
  try {
    globalThis.fetch = ok(live) as typeof fetch;
    const first = await fetchPrices();
    assert.equal(first.SOL, 105.26);

    globalThis.fetch = (async () => {
      throw new Error("429 rate limited");
    }) as typeof fetch;
    const second = await fetchPrices();

    assert.deepEqual(second, first, "a rate limit repriced the whole book");
  } finally {
    globalThis.fetch = original;
    console.warn = quiet;
  }
});

test("an empty quote counts as a failure, not as prices", async () => {
  const { fetchPrices } = loadPrices();
  const original = globalThis.fetch;
  const quiet = console.warn;
  console.warn = () => {};
  try {
    globalThis.fetch = ok(live) as typeof fetch;
    const first = await fetchPrices();

    // 200 with an unusable body: the shape CoinGecko returns for an unknown id.
    globalThis.fetch = ok({}) as typeof fetch;
    assert.deepEqual(await fetchPrices(), first);
  } finally {
    globalThis.fetch = original;
    console.warn = quiet;
  }
});

test("with nothing real yet, placeholders are all there is", async () => {
  const { fetchPrices } = loadPrices();
  const original = globalThis.fetch;
  const quiet = console.warn;
  console.warn = () => {};
  try {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const cold = await fetchPrices();
    // Nothing is mis-marked against these: any entry taken now is measured
    // against the same numbers.
    assert.ok(cold.BTC > 0 && cold.SOL > 0);
  } finally {
    globalThis.fetch = original;
    console.warn = quiet;
  }
});
