/**
 * Two places answer the design conversation: this server, and a Vercel route in
 * the frontend for deployments with no agent server running. They must ask the
 * model for the same thing.
 *
 * The prompt is what makes the reply parseable — it is where the JSON shape is
 * specified. If one copy gains a field the other does not, the bot you build is
 * a different bot depending on where you built it, and the failure is silent:
 * the chat still answers, it just stops producing something saveable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

/** The prompt is a plain template literal in both files. */
function designerPrompt(source: string): string {
  const m = source.match(/const DESIGNER_PROMPT = `([\s\S]*?)`;/);
  assert.ok(m, "DESIGNER_PROMPT not found");
  return m[1];
}

const server = designerPrompt(read("../src/server.ts"));
const route = designerPrompt(read("../../frontend/src/app/api/bot/design/route.ts"));

test("the serverless designer asks for exactly what the agent server asks for", () => {
  assert.equal(route, server);
});

test("and both still specify the JSON the UI parses", () => {
  for (const field of ["reply", "ready", "name", "strategy"]) {
    assert.match(server, new RegExp(`"${field}"`), `prompt no longer mentions ${field}`);
  }
});
