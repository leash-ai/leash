/**
 * Probe every configured LLM provider, one at a time and then as a chain.
 *
 * Answers the question you actually have after pasting a key: does it work, and
 * will the fallback catch me if it stops. Testing each backend in isolation
 * matters — a chain that works tells you the primary is fine *or* that the
 * fallback quietly covered for it, and those are different situations.
 *
 *   npx ts-node scripts/check-llm.ts
 */
import dotenv from "dotenv";
dotenv.config();

import { makeLlmClient, ChatMessage } from "../src/llm";

const PROBE: ChatMessage[] = [
  { role: "system", content: "Reply with exactly one word." },
  { role: "user", content: "Say OK" },
];

interface Target {
  label: string;
  env: Record<string, string | undefined>;
}

function configured(): Target[] {
  const t: Target[] = [];
  if (process.env.AI_BASE_URL && process.env.AI_API_KEY) {
    t.push({
      label: `primary   ${process.env.AI_MODEL || "?"} @ ${host(process.env.AI_BASE_URL)}`,
      env: {
        AI_BASE_URL: process.env.AI_BASE_URL,
        AI_API_KEY: process.env.AI_API_KEY,
        AI_MODEL: process.env.AI_MODEL,
      },
    });
  }
  if (process.env.AI_FALLBACK_BASE_URL && process.env.AI_FALLBACK_API_KEY) {
    t.push({
      label: `fallback  ${process.env.AI_FALLBACK_MODEL || "?"} @ ${host(process.env.AI_FALLBACK_BASE_URL)}`,
      env: {
        AI_BASE_URL: process.env.AI_FALLBACK_BASE_URL,
        AI_API_KEY: process.env.AI_FALLBACK_API_KEY,
        AI_MODEL: process.env.AI_FALLBACK_MODEL,
      },
    });
  }
  if (process.env.MISTRAL_API_KEY) {
    t.push({ label: "mistral   last resort", env: { MISTRAL_API_KEY: process.env.MISTRAL_API_KEY } });
  }
  return t;
}

const host = (u: string) => u.replace(/^https?:\/\//, "").split("/")[0];

/** Run one probe with only `env` visible, so the others cannot answer for it. */
async function probe(env: Record<string, string | undefined>): Promise<{ ok: boolean; detail: string; ms: number }> {
  const keys = ["AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_FALLBACK_BASE_URL", "AI_FALLBACK_API_KEY", "AI_FALLBACK_MODEL", "MISTRAL_API_KEY"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;

  const started = Date.now();
  try {
    const reply = await makeLlmClient().complete(PROBE, 16, 0);
    return { ok: true, detail: reply.trim().slice(0, 40) || "(empty reply)", ms: Date.now() - started };
  } catch (e) {
    return { ok: false, detail: String((e as Error).message).slice(0, 110), ms: Date.now() - started };
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  }
}

async function main() {
  const targets = configured();
  if (targets.length === 0) {
    console.log("\n  Nothing configured. Set AI_BASE_URL + AI_API_KEY in agent/.env.");
    console.log("  Groq: https://console.groq.com/keys   xAI: https://console.x.ai\n");
    process.exit(1);
  }

  console.log(`\n  ${targets.length} provider(s) configured — probing each on its own\n`);

  let working = 0;
  for (const t of targets) {
    const r = await probe(t.env);
    console.log(`  ${r.ok ? "✅" : "❌"} ${t.label.padEnd(46)} ${r.ok ? `"${r.detail}" (${r.ms}ms)` : r.detail}`);
    if (r.ok) working++;
  }

  // The chain as the agent will actually use it.
  const chain = await probe({
    AI_BASE_URL: process.env.AI_BASE_URL, AI_API_KEY: process.env.AI_API_KEY, AI_MODEL: process.env.AI_MODEL,
    AI_FALLBACK_BASE_URL: process.env.AI_FALLBACK_BASE_URL, AI_FALLBACK_API_KEY: process.env.AI_FALLBACK_API_KEY,
    AI_FALLBACK_MODEL: process.env.AI_FALLBACK_MODEL,
    MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
  });
  console.log(`\n  ${chain.ok ? "✅" : "❌"} chain as the agent runs it${chain.ok ? `                    "${chain.detail}"` : `  ${chain.detail}`}`);

  if (working === 0) {
    console.log("\n  No provider answered — the agent will hold every tick.\n");
    process.exit(1);
  }
  if (working < targets.length) {
    console.log(`\n  ${working}/${targets.length} answered. The chain still works, but you are down to ${working === 1 ? "no spare" : "fewer spares"}.\n`);
    process.exit(0);
  }
  if (working === 1) {
    // "if one stops, the next takes over" would be a lie with nothing behind it.
    console.log("\n  1 provider, working — but no spare. If it stops, the agent holds every tick.\n");
    return;
  }
  console.log(`\n  All ${working} answered — if one stops, the next takes over.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
