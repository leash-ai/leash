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
 * Fallback used when the price API is unreachable.
 *
 * Every strategy scores itself on price *changes*, so a duel running entirely on
 * these is a flat 0% for both sides rather than a wrong result — the numbers only
 * need to be plausible, not current.
 */
const FALLBACK: Omit<PriceData, "timestamp"> = { BTC: 65_000, ETH: 3_500, SOL: 150 };

export async function fetchPrices(): Promise<PriceData> {
  try {
    const res = await axios.get(SPOT_URL, { timeout: 5000 });
    return {
      BTC: res.data.bitcoin.usd,
      ETH: res.data.ethereum.usd,
      SOL: res.data.solana.usd,
      timestamp: Date.now(),
    };
  } catch {
    return { ...FALLBACK, timestamp: Date.now() };
  }
}
