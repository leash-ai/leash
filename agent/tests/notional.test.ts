/**
 * Scoring must not decide the duel.
 *
 * The multiplier exists so a three-hundredths-of-a-percent margin is visible
 * while it happens. It has to be the *only* thing it does: both agents pass
 * through here, so if it ever changed an ordering it would be picking winners
 * on a display concern.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { scoreBps, LEVERAGE } from "../notional";

test("scaling never reorders two scores", () => {
  const samples = [-9999, -640, -37, -3, -1, 0, 1, 3, 37, 640, 9999];
  for (const a of samples) {
    for (const b of samples) {
      assert.equal(
        Math.sign(scoreBps(a) - scoreBps(b)),
        Math.sign(a - b),
        `ordering changed for ${a} vs ${b}`,
      );
    }
  }
});

test("a real move becomes a visible one", () => {
  // 0.03% is what a ten-minute duel actually produces, and what drew a flat line.
  assert.equal(scoreBps(3), 3 * LEVERAGE);
  assert.ok(Math.abs(scoreBps(3)) >= 50, "still too small to see");
});

test("flat stays flat", () => {
  assert.equal(scoreBps(0), 0);
});

test("it rounds rather than truncating toward the tie", () => {
  // Truncation would pull every score toward zero, and a tie goes to agentB by
  // contract rule — so the bias would have a beneficiary.
  //
  // The inputs are derived from LEVERAGE rather than written out: hardcoded ones
  // stopped distinguishing rounding from truncation the moment the multiplier
  // changed, and the test then failed for saying nothing rather than for being
  // wrong. A fractional part above a half is what makes the two disagree.
  // Sign applied after the offset: adding 0.7 to a negative whole moves it
  // toward zero and lands on a fraction below a half, which tests nothing.
  const overHalf = (whole: number) =>
    (Math.sign(whole) * (Math.abs(whole) + 0.7)) / LEVERAGE;

  for (const real of [overHalf(3), overHalf(-3), overHalf(41), overHalf(-41)]) {
    const scaled = real * LEVERAGE;
    assert.equal(scoreBps(real), Math.round(scaled));
    assert.notEqual(Math.round(scaled), Math.trunc(scaled), `${real} does not test rounding`);
  }
});

test("the result stays inside what updateLivePnL accepts", () => {
  // DuelManager bounds live PnL at ±100_000_000 bps.
  for (const extreme of [1e9, -1e9, Number.MAX_SAFE_INTEGER]) {
    assert.ok(Math.abs(scoreBps(extreme)) <= 100_000_000);
  }
});
