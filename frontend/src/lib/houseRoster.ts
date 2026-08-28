/**
 * The house side, for display.
 *
 * Mirrors agent/strategies/roster.ts. Duplicated rather than imported: the agent
 * is a separate package with its own build, and reaching across for six names
 * would cost a build step to save a file. agent/tests/roster-mirror.test.ts
 * fails if the two drift, which is the part that actually matters — a page that
 * lists opponents you will never meet is worse than no page.
 */
export interface HouseBot {
  name: string;
  style: string;
}

export const HOUSE_ROSTER: HouseBot[] = [
  { name: "Blitz", style: "momentum, two-tick lookback — chases anything that moves" },
  { name: "Drift", style: "momentum, six-tick lookback — ignores noise, commits late" },
  { name: "Rebound", style: "mean reversion, 1% threshold — buys every dip, trades constantly" },
  { name: "Contrarian", style: "mean reversion, patient — only acts on a move worth acting on" },
  { name: "Scalper", style: "market maker, 7-period RSI, tight bands — in and out quickly" },
  { name: "Sentinel", style: "market maker, long RSI — slow to commit, slow to leave" },
];

/**
 * Which of the six a duel drew.
 *
 * Mirrors houseIndex in agent/strategies/roster.ts byte for byte — same FNV-1a,
 * same 32-bit arithmetic — because the whole point is that this page and the bot
 * that actually played reach the same answer from nothing but what the chain
 * stores. agent/tests/roster-mirror.test.ts runs both over the same inputs and
 * fails on the first disagreement.
 *
 * startTime is block.timestamp at join, so it does not exist while you are
 * choosing your bot. You still cannot tune against an opponent; you just get to
 * see who it was.
 */
export function houseIndex(duelId: number, startTime: number): number {
  let h = 0x811c9dc5;
  for (const ch of `${duelId}:${startTime}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % HOUSE_ROSTER.length;
}

/** The house bot this duel drew, or null before anyone has joined. */
export function opponentFor(duelId: number, startTime: number): HouseBot | null {
  if (!startTime) return null;
  return HOUSE_ROSTER[houseIndex(duelId, startTime)];
}
