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
