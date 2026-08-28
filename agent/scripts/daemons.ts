/**
 * daemons.ts — keep the two processes the platform depends on alive.
 *
 * Neither is optional, and each fails silently in its own way:
 *
 *   houseBot   nobody takes a challenge. The duel sits Open, the stake sits in
 *              the contract, and the page says "waiting for opponent" forever.
 *   resolver   duels finish and stay Active, holding both stakes, because
 *              resolveDuel is permissionless and nobody calls it.
 *
 * Started by hand they die with the terminal, and they die quietly — the site
 * keeps loading, the chain keeps answering, and the only symptom is that nothing
 * happens. That has already caught me twice: a house bot gone between sessions
 * looked like a bug in the join logic, and duels stuck Active looked like a
 * contract problem.
 *
 * So: one command, both supervised, restarted on exit with a backoff that gives
 * up on a crash loop rather than hammering the RPC.
 *
 *   npm run daemons
 *
 * It is not a service manager. Closing the terminal still stops it — but one
 * window to watch beats two, and a crash at 3am is now a restart rather than an
 * outage until someone notices.
 */
import { spawn, ChildProcess } from "child_process";
import { join } from "path";

interface Daemon {
  name: string;
  cwd: string;
  args: string[];
}

const ROOT = join(__dirname, "../..");

const DAEMONS: Daemon[] = [
  { name: "house", cwd: join(ROOT, "agent"), args: ["ts-node", "houseBot.ts"] },
  { name: "resolve", cwd: join(ROOT, "contracts"), args: ["ts-node", "scripts/resolver.ts", "10"] },
];

/** Backoff, so a misconfigured daemon does not spin. Reset once it has held. */
const FIRST_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;
const HEALTHY_MS = 30_000;

const stamp = () => new Date().toTimeString().slice(0, 8);
const running = new Map<string, ChildProcess>();
let stopping = false;

function start(d: Daemon, delay = FIRST_DELAY_MS) {
  if (stopping) return;

  const startedAt = Date.now();
  const child = spawn("npx", d.args, { cwd: d.cwd, env: process.env });
  running.set(d.name, child);

  const relay = (buf: Buffer) => {
    for (const line of buf.toString().split("\n")) {
      if (line.trim()) console.log(`[${d.name}] ${line}`);
    }
  };
  child.stdout?.on("data", relay);
  child.stderr?.on("data", relay);

  child.on("exit", (code, signal) => {
    running.delete(d.name);
    if (stopping) return;

    // A daemon that ran a while was working; treat this as a fresh failure
    // rather than the next step of an old backoff.
    const held = Date.now() - startedAt >= HEALTHY_MS;
    const next = held ? FIRST_DELAY_MS : Math.min(delay * 2, MAX_DELAY_MS);

    console.log(
      `[${stamp()}] ${d.name} exited (${signal ?? code}) — restarting in ${next / 1000}s`,
    );
    setTimeout(() => start(d, next), next);
  });
}

for (const d of DAEMONS) {
  console.log(`[${stamp()}] starting ${d.name}: ${d.args.join(" ")}`);
  start(d);
}

// Ctrl-C should stop both, not orphan them. Without this the children survive
// and the next run competes with itself — which has produced duels joined twice
// and an e2e run contaminated by a daemon nobody knew was still up.
const shutdown = () => {
  stopping = true;
  console.log(`\n[${stamp()}] stopping ${running.size} daemon(s)`);
  for (const child of running.values()) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 1500);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
