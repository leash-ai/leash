const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  AVAX: "avalanche-2",
};

export interface Prices {
  [symbol: string]: number;
}

/**
 * The last prices that were actually real.
 *
 * A hardcoded fallback is worse than no prices at all here. CoinGecko's free tier
 * rate-limits mid-duel, so ticks alternate between live and fallback — and the
 * fallback is a different price level, not a continuation. A position opened at
 * SOL 105 was marked at the fallback's 145 on the next tick, which is a 38% move
 * on that asset and put a five-minute duel at +11.33% before snapping back to
 * -0.08%. Both numbers went on-chain, and settlement pins to the last one, so a
 * rate limit could decide who won.
 *
 * Carrying the last real print forward makes a failed fetch score as no movement,
 * which is what a missing observation actually means.
 */
let lastGood: Prices | null = null;

export async function fetchPrices(): Promise<Prices> {
  try {
    const ids = Object.values(COINGECKO_IDS).join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = (await res.json()) as any;
    const prices: Prices = {};
    for (const [sym, id] of Object.entries(COINGECKO_IDS)) {
      if (data[id]?.usd) prices[sym] = data[id].usd;
    }
    if (Object.keys(prices).length === 0) throw new Error("CoinGecko returned no prices");
    lastGood = prices;
    return prices;
  } catch (e) {
    if (lastGood) {
      console.warn(`Price fetch failed (${(e as Error).message}) — holding last prices`);
      return { ...lastGood };
    }
    // Nothing real has arrived yet, so there is no position to mis-mark: every
    // strategy scores on changes from its entry, and an entry taken here is
    // measured against the same numbers.
    console.warn(`Price fetch failed (${(e as Error).message}) — no prices yet, using placeholders`);
    return { BTC: 97000, ETH: 3200, SOL: 145, BNB: 600, AVAX: 38 };
  }
}
