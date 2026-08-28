/**
 * How hard a duel is scored.
 *
 * Spot crypto over ten minutes moves fractions of a percent. A strategy putting
 * 30% of its cash behind a 0.1% move earns 0.03%, so two agents finish a duel
 * separated by three hundredths of a percent — a real result, and completely
 * unwatchable. The chart drew two flat lines and "watch both returns move in
 * real time" was a promise the numbers could not keep.
 *
 * So the duel is scored on a notional position rather than the cash one: the
 * same trades, sized as if each agent were running LEVERAGE times its capital.
 * Nothing about who wins changes — it is one multiplier applied to both sides,
 * so the ordering is identical — but the margin becomes something you can see
 * moving while it happens.
 *
 * It is applied where the score is reported, not where it is computed, so a
 * strategy's own arithmetic stays in real terms and the tests that check it keep
 * meaning what they meant. Both agents go through here, and settlement pins to
 * the last reported value, so the encrypted score is the leveraged one too — the
 * number on screen is the number that settles.
 *
 * DuelManager bounds live PnL at ±100,000,000 bps (±1,000,000%), so there is no
 * risk of multiplying into a revert; the clamp below is about honesty, not
 * limits. A duel is a fixed-stake game and the leverage is a scoring rule, not a
 * loan: nobody is liquidated and nobody owes more than the stake.
 */

/** Chosen so a typical ten-minute duel finishes somewhere in ±1%, not ±0.05%. */
export const LEVERAGE = 20;

/** Kept well inside DuelManager's bound, and far past anything a duel produces. */
const CAP_BPS = 5_000_000; // ±50,000%

/**
 * Scale a real return into the duel's scoring.
 *
 * Rounds rather than truncates: at these sizes truncation biases every score
 * toward zero, and toward the tie that agentB wins by rule.
 */
export function scoreBps(realBps: number): number {
  const scaled = Math.round(realBps * LEVERAGE);
  return Math.max(-CAP_BPS, Math.min(CAP_BPS, scaled));
}
