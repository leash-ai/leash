/**
 * The frontend lists the opponents it can put you against. That list is a copy,
 * so it can drift — and a page promising six bots that no longer exist is worse
 * than a page with no list at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROSTER } from "../strategies/roster";

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
