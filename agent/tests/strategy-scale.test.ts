/**
 * A bot whose trigger cannot fire is a bot that does not play, and it looks
 * identical to a broken one from the outside: a flat line at 0.00%.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { triggerPercentages, unreachableTriggers } from "../src/strategyScale";

test("a position size is not a trigger", () => {
  const s = "Buy 50% of cash when the asset rises 0.08%, then sell 100% of the position.";
  assert.deepEqual(triggerPercentages(s), [0.08]);
  assert.deepEqual(unreachableTriggers(s), []);
});

test("it catches the daily-chart thresholds the designer keeps writing", () => {
  const s = "If any asset gains 1.5% over three ticks, buy 80% of cash. Exit on a 2% drop.";
  assert.deepEqual(unreachableTriggers(s), [1.5, 2]);
});

test("a workable strategy passes", () => {
  const s =
    "Buy the strongest of BTC, ETH, SOL when it moves 0.06% over two points, " +
    "using 100% of cash. Exit if it gives back 0.03%.";
  assert.deepEqual(unreachableTriggers(s), []);
});

test("sizes in other phrasings are still sizes", () => {
  for (const s of [
    "allocate 40% of capital",
    "commit 75% of the portfolio",
    "reduce by 50% of position",
    "deploy 60% of available cash",
  ]) {
    assert.deepEqual(unreachableTriggers(s), [], s);
  }
});

test("determiners between the size and its noun do not turn it into a trigger", () => {
  // "100% of that position" was read as a 100% trigger and sent the designer
  // into a rewrite it did not need.
  const s = "BUY 80% of available cash. SELL 100% of that position on a 0.04% drop.";
  assert.deepEqual(unreachableTriggers(s), []);
  assert.deepEqual(triggerPercentages(s), [0.04]);
});

test("the verb in front is enough on its own", () => {
  assert.deepEqual(unreachableTriggers("SELL 100% immediately"), []);
  assert.deepEqual(unreachableTriggers("buy up to 75% and hold"), []);
});

test("a bare percentage with nothing after it counts as a trigger", () => {
  // Safer to ask for a rewrite than to let an unreachable one through.
  assert.deepEqual(unreachableTriggers("exit at 3%"), [3]);
});
