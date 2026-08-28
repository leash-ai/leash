/**
 * The frontend lists the opponents it can put you against. That list is a copy,
 * so it can drift — and a page promising six bots that no longer exist is worse
 * than a page with no list at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROSTER, houseIndex } from "../strategies/roster";
import {
  HOUSE_ROSTER,
  houseIndex as mirrorIndex,
  opponentFor,
} from "../../frontend/src/lib/houseRoster";

const mirror = readFileSync(
  join(__dirname, "../../frontend/src/lib/houseRoster.ts"),
  "utf8",
);

test("the frontend roster names the same bots as the agent's", () => {
  const shown = [...mirror.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(shown, ROSTER.map((o) => o.name));
});

test("and describes them the same way", () => {
  const styles = [...mirror.matchAll(/style:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(styles, ROSTER.map((o) => o.style));
});

/**
 * The draw is derived, not recorded — the bot that plays and the page that names
 * it each compute it from (duelId, startTime). Agreement is the entire mechanism:
 * one bit of divergence in the hash and the page confidently names the wrong
 * opponent, which is worse than naming none, because nothing looks broken.
 */
test("both sides derive the same opponent from the same duel", () => {
  for (let duelId = 0; duelId < 60; duelId++) {
    for (const startTime of [1, 1756400000, 1756400001, 2147483647]) {
      assert.equal(
        houseIndex(duelId, startTime),
        mirrorIndex(duelId, startTime),
        `disagreed on duel ${duelId} at ${startTime}`,
      );
      assert.equal(
        HOUSE_ROSTER[mirrorIndex(duelId, startTime)].name,
        ROSTER[houseIndex(duelId, startTime)].name,
      );
    }
  }
});

/** A one-second difference must not land on the same bot every time. */
test("the draw spreads across the roster", () => {
  const seen = new Set<number>();
  for (let t = 0; t < 200; t++) seen.add(houseIndex(7, 1756400000 + t));
  assert.equal(seen.size, ROSTER.length, "some opponents are never drawn");
});

test("no opponent is named before anyone has joined", () => {
  assert.equal(opponentFor(7, 0), null);
});
