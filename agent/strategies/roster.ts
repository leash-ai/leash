/**
 * The house side of a duel: a stable of opponents, drawn at random.
 *
 * One bot playing one strategy makes every match the same match. These six are
 * not renames — each pairs a strategy with tuning that changes what it actually
 * does, so which one you draw decides how the duel feels:
 *
 *   momentum       short lookback chases every move; long ignores noise and
 *                  enters late
 *   meanReversion  a low threshold trades constantly on small dislocations; a
 *                  high one waits for real ones and mostly sits still
 *   marketMaker    a short RSI period is twitchy; a long one is slow to commit
 *
 * Tuned against a duel that lasts minutes, not days, and the ceiling is tighter
 * than it looks. At a 30-second tick a ten-minute duel is twenty data points, so
 * an RSI period of 18 is not "slow" — it is an indicator that never becomes
 * computable before the clock stops. A 3.5% mean-reversion trigger is reasonable
 * on a daily chart and never fires inside ten minutes. The first pass had two of
 * these six sitting out every duel; that is not a conservative opponent, it is
 * no opponent. Every entry below is checked to actually trade.
 *
 * All of it is rules over the price feed. No model, no API key, nothing that can
 * stop answering because a provider is down — which matters for the one thing
 * this roster exists to guarantee: that a challenge always gets taken.
 */
import { MomentumStrategy } from "./momentum";
import { MeanReversionStrategy } from "./meanReversion";
import { MarketMakerStrategy } from "./marketMaker";
import { Strategy } from "./types";

export interface Opponent {
  name: string;
  /** One line, shown when the match is announced. */
  style: string;
  build: () => Strategy;
}

export const ROSTER: Opponent[] = [
  {
    name: "Blitz",
    style: "momentum, two-tick lookback — chases anything that moves",
    build: () => new MomentumStrategy(1000, 2),
  },
  {
    name: "Drift",
    style: "momentum, six-tick lookback — ignores noise, commits late",
    build: () => new MomentumStrategy(1000, 6),
  },
  {
    name: "Rebound",
    style: "mean reversion, 1% threshold — buys every dip, trades constantly",
    build: () => new MeanReversionStrategy(4, 0.01),
  },
  {
    name: "Contrarian",
    style: "mean reversion, patient — only acts on a move worth acting on",
    build: () => new MeanReversionStrategy(8, 0.012),
  },
  {
    name: "Scalper",
    style: "market maker, 7-period RSI, tight bands — in and out quickly",
    build: () => new MarketMakerStrategy(7, 35, 65),
  },
  {
    name: "Sentinel",
    style: "market maker, long RSI — slow to commit, slow to leave",
    build: () => new MarketMakerStrategy(9, 40, 60),
  },
];

/**
 * Draw an opponent. Random on purpose: knowing who you face lets you tune
 * against them, and a duel where the counter is known is not much of a duel.
 */
export function drawOpponent(): Opponent {
  return ROSTER[Math.floor(Math.random() * ROSTER.length)];
}
