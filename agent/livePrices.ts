/**
 * Prices in the background, so a score can be marked between transactions.
 *
 * A COTI block is about six seconds and every published score is a transaction,
 * so the on-chain curve cannot go faster than that however hard the agents try.
 * The values in between are not unknown though: an agent holds a portfolio and
 * the market has a price for it right now. Marking that continuously is what
 * makes the curve move, and it costs nothing on-chain.
 *
 * One poller per process, shared. Binance's ticker is a weight-2 request and the
 * limit is 1200 a minute, so 400ms leaves an order of magnitude of headroom even
 * with the agent server and the house bot both running.
 *
 * The marks are for watching. What settles is what was published — see
 * DuelManager.submitFinalPnL, which pins the encrypted score to the last public
 * report — so this can never decide a duel.
 */
import { fetchPrices, Prices } from "./src/prices";

const INTERVAL_MS = 400;

let latest: Prices | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let users = 0;

async function poll() {
  try {
    latest = await fetchPrices();
  } catch {
    /* fetchPrices already holds the last real print; a miss changes nothing */
  }
}

/** Start polling, or join a poll already running. Returns a stop function. */
export function startLivePrices(): () => void {
  users += 1;
  if (!timer) {
    void poll();
    timer = setInterval(poll, INTERVAL_MS);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    users -= 1;
    if (users <= 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The most recent prices, or null before the first poll lands. */
export function currentPrices(): Prices | null {
  return latest;
}
