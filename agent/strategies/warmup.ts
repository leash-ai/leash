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
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PriceData } from "./momentum";
import { Strategy } from "./types";

const COINGECKO_IDS = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana" } as const;

/**
 * One request for all three assets, not one per asset.
 *
 * /coins/{id}/market_chart is per-coin, so seeding three assets meant three
 * calls — and with two daemons starting together that is six, which CoinGecko's
 * free tier throttles. The first live run got "No price history available" from
 * exactly that. /coins/markets takes an id list and returns a 7-day hourly
 * sparkline for each, in a single call.
 */
const MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets" +
  `?vs_currency=usd&ids=${Object.values(COINGECKO_IDS).join(",")}&sparkline=true`;

interface MarketEntry {
  id: string;
  sparkline_in_7d?: { price?: number[] };
}

/** Cached per process: a rebuilt strategy reuses it instead of re-requesting. */
let cached: Promise<PriceData[]> | undefined;

/**
 * Cached on disk too, because the per-process cache does not help across
 * processes and that is exactly where this failed. The owner's daemon and the
 * renter's start together, both ask CoinGecko, and the free tier answers one of
 * them with a 429 whose window is far longer than any backoff worth waiting
 * through — the second daemon reliably started cold.
 *
 * The data is hourly, so a shared file good for 30 minutes costs nothing in
 * freshness and means one fetch per machine rather than one per process.
 */
const CACHE_FILE = join(__dirname, "..", ".price-history-cache.json");
const CACHE_TTL_MS = 30 * 60 * 1000;

function readCacheFile(): PriceData[] | null {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as { fetchedAt: number; points: PriceData[] };
    if (!raw?.points?.length) return null;
    if (Date.now() - raw.fetchedAt > CACHE_TTL_MS) return null;
    return raw.points;
  } catch {
    return null; // absent, unreadable or malformed — just refetch
  }
}

function writeCacheFile(points: PriceData[]): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), points }));
  } catch {
    // a read-only checkout is not a reason to fail a warm-up
  }
}

/**
 * Retry on a throttled response.
 *
 * CoinGecko's free tier rate-limits, and the owner's daemon and the renter's
 * start within a second of each other in separate processes — the in-process
 * cache cannot help across that. One of the two reliably got a 429 and started
 * cold. A couple of spaced retries clears it.
 */
async function fetchWithRetry(url: string, attempts = 3): Promise<Response | null> {
  let last: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 1500 * i + Math.random() * 700));
      // The other daemon may have won the race and written the file by now.
      if (readCacheFile()) return null;
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) return res;
      last = new Error(`CoinGecko ${res.status}`);
      if (res.status !== 429 && res.status < 500) break; // not worth retrying
    } catch (e) {
      last = e as Error;
    }
  }
  throw last ?? new Error("CoinGecko unreachable");
}

async function loadHistory(): Promise<PriceData[]> {
  const shared = readCacheFile();
  if (shared) return shared;

  const res = await fetchWithRetry(MARKETS_URL);
  if (res === null) {
    const written = readCacheFile();
    if (written) return written;
    throw new Error("CoinGecko rate limited and no shared cache");
  }
  const body = (await res.json()) as MarketEntry[];
  if (!Array.isArray(body)) throw new Error("unexpected CoinGecko response");

  const series: Record<string, number[]> = {};
  for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
    const prices = body.find((e) => e.id === id)?.sparkline_in_7d?.price;
    if (!prices?.length) throw new Error(`no sparkline for ${id}`);
    series[symbol] = prices;
  }

  // Hourly points, same cadence and length for each asset, oldest first.
  const available = Math.min(...Object.values(series).map((s) => s.length));
  const now = Date.now();
  const out: PriceData[] = [];
  for (let i = 0; i < available; i++) {
    out.push({
      BTC: series.BTC[i],
      ETH: series.ETH[i],
      SOL: series.SOL[i],
      timestamp: now - (available - 1 - i) * 3_600_000,
    });
  }
  writeCacheFile(out);
  return out;
}

/** Recent price points, oldest first, plus why there are none if there are none. */
export async function fetchPriceHistory(
  points: number,
): Promise<{ history: PriceData[]; error?: string }> {
  try {
    cached ??= loadHistory();
    const all = await cached;
    return { history: all.slice(-points) };
  } catch (e) {
    cached = undefined; // let a later attempt retry rather than caching a failure
    return { history: [], error: (e as Error).message };
  }
}

/**
 * Feed a strategy enough history to trade on its first tick.
 *
 * Best effort: if the price API is unreachable the strategy starts cold, the way
 * it did before. Returns the count and, on failure, the reason — a warm-up that
 * silently reports zero is indistinguishable from one that was never attempted,
 * and that ambiguity cost real time diagnosing a rate limit.
 */
export async function warmUpStrategy(
  strategy: Strategy,
  points = 5,
): Promise<{ points: number; error?: string }> {
  const { history, error } = await fetchPriceHistory(points);
  for (const point of history) strategy.addPriceData(point);
  return { points: history.length, error };
}
