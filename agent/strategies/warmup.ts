/**
 * Seed a strategy with recent real prices before a duel starts.
 *
 * Every strategy needs a few price points before it will trade — momentum's
 * LOOKBACK is 3. The daemons tick every UPDATE_INTERVAL_MS (30s by default), so
 * a cold start spends the first ~90 seconds of a duel unable to open a position.
 * On a short demo duel that is most of it: both agents report 0.00% throughout,
 * the duel is a tie, and DuelManager's documented tie rule hands it to agentB.
 * That is not a strategy losing, it is a strategy never getting to play.
 *
 * Pulling the last few minutes of real prices from CoinGecko fixes it — the
 * strategy starts warm and can act on its first tick. Seeding with repeated
 * copies of the current price would not: every return would be zero and momentum
 * would still see no signal.
 */
import { PriceData } from "./momentum";
import { Strategy } from "./types";

const COINGECKO_IDS = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana" } as const;

/** Recent price points, oldest first. Empty if history is unavailable. */
export async function fetchPriceHistory(points: number): Promise<PriceData[]> {
  try {
    const series: Record<string, [number, number][]> = {};

    for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
      const url =
        `https://api.coingecko.com/api/v3/coins/${id}/market_chart` +
        `?vs_currency=usd&days=1&interval=hourly`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`CoinGecko ${res.status} for ${id}`);
      const body = (await res.json()) as { prices?: [number, number][] };
      if (!body.prices?.length) throw new Error(`no price series for ${id}`);
      series[symbol] = body.prices;
    }

    // Line the three series up on their last `points` samples. They come back
    // the same length and cadence, so index alignment is enough here.
    const available = Math.min(...Object.values(series).map((s) => s.length));
    const take = Math.min(points, available);
    const out: PriceData[] = [];

    for (let i = available - take; i < available; i++) {
      out.push({
        BTC: series.BTC[i][1],
        ETH: series.ETH[i][1],
        SOL: series.SOL[i][1],
        timestamp: series.BTC[i][0],
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Feed a strategy enough history to trade on its first tick.
 *
 * Best effort: if CoinGecko is unreachable the strategy simply starts cold, the
 * way it did before. Returns how many points were seeded so the caller can say
 * so in its log rather than leaving the operator guessing.
 */
export async function warmUpStrategy(strategy: Strategy, points = 5): Promise<number> {
  const history = await fetchPriceHistory(points);
  for (const point of history) strategy.addPriceData(point);
  return history.length;
}
