/**
 * Live spot prices for the three assets the strategies trade.
 *
 * Was copied into agent.ts, rentalListener.ts and renterListener.ts — three
 * versions of the same function that differed only in variable names, formatting
 * and their fallback numbers. One of them silently quoted BTC at 97k and another
 * at 65k, so which runtime you happened to start decided what "the price" was
 * when CoinGecko was down.
 *
 * Distinct from src/prices.ts, which serves the HTTP server over a wider asset
 * set and a different shape. Not merged, because they are answering different
 * questions.
 */
import axios from "axios";
import { PriceData } from "./strategies/momentum";

const SPOT_URL =
  "https://api.coingecko.com/api/v3/simple/price" +
  "?ids=bitcoin,ethereum,solana&vs_currencies=usd";

/**
 * Placeholders for a cold start, and nothing else.
 *
 * They used to be returned on every failed fetch, on the reasoning that
 * strategies score on price *changes* so a duel spent entirely on them is a flat
 * 0%. The reasoning holds only if every tick is a fallback. In practice
 * CoinGecko's free tier rate-limits mid-duel and the ticks alternate — and these
 * numbers are a different price level, not a continuation, so a position opened
 * at the real SOL is suddenly marked 40% away and the score jumps by double
 * digits. That number goes on-chain, and settlement pins to the last one.
 *
 * They also disagreed with src/prices.ts, which had its own set. Which runtime
 * you started decided how big the jump was.
 */
const COLD_START: Omit<PriceData, "timestamp"> = { BTC: 65_000, ETH: 3_500, SOL: 150 };

/** The last prices that were actually real. A failed fetch holds these. */
let lastGood: Omit<PriceData, "timestamp"> | null = null;

export async function fetchPrices(): Promise<PriceData> {
  try {
    const res = await axios.get(SPOT_URL, { timeout: 5000 });
    const prices = {
      BTC: res.data.bitcoin.usd,
      ETH: res.data.ethereum.usd,
      SOL: res.data.solana.usd,
    };
    if (!prices.BTC || !prices.ETH || !prices.SOL) throw new Error("incomplete quote");
    lastGood = prices;
    return { ...prices, timestamp: Date.now() };
  } catch {
    // A missing observation means no movement, not a move to somewhere else.
    return { ...(lastGood ?? COLD_START), timestamp: Date.now() };
  }
}
