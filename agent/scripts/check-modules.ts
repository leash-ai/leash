/**
 * Load every agent entrypoint and shared module for real.
 *
 * `tsc --noEmit` does not prove a module can be imported at runtime. The clearest
 * case: @coti-io/coti-sdk-private-messaging ships ESM only, but declares a
 * top-level "types" field that resolves under moduleResolution node10 — so the
 * broken import typechecked and then threw ERR_PACKAGE_PATH_NOT_EXPORTED the
 * first time a daemon started. Nothing in CI would have caught that.
 *
 * Entrypoints with top-level side effects are deliberately excluded; this checks
 * modules that are safe to import, plus the SDK loader itself.
 */
import { privateMessagingSdk } from "../messaging/sdk";

const MODULES = [
  "../strategies/types",
  "../strategies/momentum",
  "../strategies/meanReversion",
  "../strategies/marketMaker",
  "../coti/settlement",
  "../src/llm",
  "../marketData",
  "../strategies/factory",
  "../strategies/warmup",
  "../messaging/commandChannel",
  "../messaging/sdk",
];

async function main() {
  let failed = 0;

  for (const m of MODULES) {
    try {
      require(m);
      console.log(`  ok   ${m}`);
    } catch (e) {
      console.error(`  FAIL ${m} — ${(e as Error).message}`);
      failed++;
    }
  }

  // The one that actually broke. Resolving it proves the ESM loader works.
  try {
    const sdk = await privateMessagingSdk();
    const missing = ["createPrivateMessagingClient", "listInbox", "sendMessage"]
      .filter((fn) => typeof (sdk as Record<string, unknown>)[fn] !== "function");
    if (missing.length) {
      console.error(`  FAIL private-messaging SDK — missing: ${missing.join(", ")}`);
      failed++;
    } else {
      console.log("  ok   private-messaging SDK loads and exports its API");
    }
  } catch (e) {
    console.error(`  FAIL private-messaging SDK — ${(e as Error).message}`);
    failed++;
  }

  if (failed) {
    console.error(`\n${failed} module(s) failed to load.`);
    process.exit(1);
  }
  console.log("\nAll modules load.");
}

main();
