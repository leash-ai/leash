/**
 * Does this strategy have a trigger a duel can actually reach?
 *
 * The designer keeps writing thresholds for daily charts — 1.5%, 2%, 3% — and a
 * duel lasts minutes, where spot crypto moves a tenth of a percent. A bot with a
 * 1.5% trigger holds every tick and finishes at 0.00%; the person watching sees a
 * flat line and a bot that "did nothing", which is exactly what it did.
 *
 * Asking the prompt not to do it was not enough, so this checks. Position sizes
 * are legitimately large — "50% of cash" is fine, encouraged even — so they are
 * told apart from triggers by what follows them.
 */

/** Above this, a trigger will not fire inside a duel. */
export const MAX_TRIGGER_PCT = 0.5;

/** "…% of the/that/its position", with room for the determiners models use. */
const SIZE_AFTER =
  /^\s*(?:of\s+)?(?:(?:the|that|this|its|their|your|each|any|all|available|current|total|remaining|open|existing|entire|held)\s+){0,3}(?:cash|capital|portfolio|positions?|balance|equity|holdings?|allocation|stake|funds)/i;

/** "BUY 80%…", which is a size whatever follows it. */
const SIZE_BEFORE =
  /(?:buy|sell|allocate|deploy|commit|invest|reduce|trim|add|enter|exit)\s+(?:up\s+to\s+)?$/i;

/**
 * Percentages used as triggers, in the order they appear.
 *
 * Sizes are told apart two ways because one is not enough: the noun after it
 * ("80% of available cash") misses determiners models like — "100% of that
 * position" read as a 100% trigger — and the verb before it ("SELL 100%") is
 * decisive on its own.
 */
export function triggerPercentages(strategy: string): number[] {
  const out: number[] = [];
  const pattern = /(\d+(?:\.\d+)?)\s*%/g;

  for (let m = pattern.exec(strategy); m; m = pattern.exec(strategy)) {
    const after = strategy.slice(m.index + m[0].length);
    const before = strategy.slice(Math.max(0, m.index - 24), m.index);
    if (SIZE_AFTER.test(after) || SIZE_BEFORE.test(before)) continue;
    out.push(Number(m[1]));
  }
  return out;
}

/** The triggers this strategy could never reach, empty when it is workable. */
export function unreachableTriggers(strategy: string): number[] {
  return triggerPercentages(strategy).filter((p) => p > MAX_TRIGGER_PCT);
}

/** One more turn, naming the numbers rather than restating the rule. */
export function rescaleRequest(offenders: number[]): string {
  const listed = offenders.map((p) => `${p}%`).join(", ");
  return (
    `That bot cannot trade here. Its triggers are ${listed}, and a two-to-ten minute ` +
    `duel on spot crypto moves about 0.1% end to end — those fire roughly never, so ` +
    `the bot would hold every tick and finish at 0.00%. Keep the same idea and the ` +
    `same name, but put every entry and exit trigger between 0.02% and ${MAX_TRIGGER_PCT}%. ` +
    `Position sizes stay as they are.`
  );
}
