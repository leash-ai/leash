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
 * than it looks — twice now I have got it wrong in the same direction.
 *
 * The first pass used lookbacks off a daily chart: an RSI period of 18 is not
 * "slow" here, it is an indicator that never becomes computable before the clock
 * stops. Fixing those left the thresholds, which were worse and harder to see —
 * momentum wanted half a percent over its lookback and mean reversion a full
 * one, while a whole duel covers about a tenth. Blitz published 0.00% for an
 * entire duel without one trade, and from the outside that is indistinguishable
 * from a broken product.
 *
 * A threshold only means something next to the span it is measured over, so both
 * are set here rather than baked into the strategies. roster-trades.test.ts runs
 * every entry over a realistic duel and fails any that never opens a position.
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
    build: () => new MomentumStrategy(1000, 2, 0.00005),
  },
  {
    name: "Drift",
    style: "momentum, six-tick lookback — ignores noise, commits late",
    build: () => new MomentumStrategy(1000, 6, 0.0002),
  },
  {
    name: "Rebound",
    style: "mean reversion, shallow — buys every dip, trades constantly",
    build: () => new MeanReversionStrategy(4, 0.00005),
  },
  {
    name: "Contrarian",
    style: "mean reversion, patient — only acts on a move worth acting on",
    build: () => new MeanReversionStrategy(8, 0.0002),
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
 * Which opponent a duel drew.
 *
 * Not Math.random, and not because randomness was wrong — it was unrecoverable.
 * A draw nobody can reproduce lives only in this process's logs, so the page you
 * watch the duel on can never tell you who you are up against, and "you might
 * face any of six" stays a claim rather than something you see.
 *
 * Hashing (duelId, startTime) keeps both properties at once. startTime is
 * block.timestamp at the moment someone joins, so it does not exist yet while
 * you are picking your bot — there is still nothing to tune against, even though
 * ids are sequential and guessable. Afterwards both sides derive the same name
 * from what the chain already stores, with no event and no index.
 *
 * FNV-1a, 32-bit, mirrored byte for byte in frontend/src/lib/houseRoster.ts. The
 * arithmetic has to agree exactly across the two, which is why it is spelled out
 * rather than borrowed: Math.imul keeps the multiply in 32 bits on both sides,
 * and >>> 0 keeps the result unsigned.
 */
export function houseIndex(duelId: number, startTime: number): number {
  let h = 0x811c9dc5;
  for (const ch of `${duelId}:${startTime}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % ROSTER.length;
}

/** The opponent this duel drew. */
export function drawOpponent(duelId: number, startTime: number): Opponent {
  return ROSTER[houseIndex(duelId, startTime)];
}
