/**
 * Keep the agent and the contracts in step.
 *
 * These two codebases agree by convention, not by a shared artifact: the offset
 * is written out as a literal in three strategies and again in coti/settlement,
 * facing DuelManager.PNL_OFFSET on the other side. Nothing links them, and a
 * drift does not fail to compile — it reverts at settlement, inside a try/catch
 * that logs a forfeit. So the failure would look like an agent losing a duel.
 *
 * Reading the .sol source is deliberate. Reading the compiled artifact would
 * only prove the agent matches whatever was last compiled locally.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Interface } from "ethers";

import { PNL_OFFSET } from "../coti/settlement";

const DUEL_MANAGER_SOL = join(__dirname, "../../contracts/contracts/DuelManager.sol");
const source = readFileSync(DUEL_MANAGER_SOL, "utf8");

/** Read `int256 public constant NAME = 1_234;` out of the Solidity source. */
function solidityConstant(name: string): number {
  const m = source.match(new RegExp(`constant\\s+${name}\\s*=\\s*(-?[\\d_]+)`));
  assert.ok(m, `${name} not found in DuelManager.sol — was it renamed?`);
  return Number(m![1].replace(/_/g, ""));
}

test("PNL_OFFSET matches DuelManager", () => {
  assert.equal(PNL_OFFSET, solidityConstant("PNL_OFFSET"),
    "the encrypted score would not equal the pinned live value");
});

test("the strategies use the same offset literal as settlement.ts", () => {
  // Three strategies hardcode it rather than importing PNL_OFFSET.
  for (const file of ["momentum", "meanReversion", "marketMaker"]) {
    const src = readFileSync(join(__dirname, `../strategies/${file}.ts`), "utf8");
    const m = src.match(/gcEncoded\s*=\s*\w+\s*\+\s*([\d_]+)/);
    assert.ok(m, `${file}.ts: could not find the gcEncoded offset`);
    assert.equal(Number(m![1].replace(/_/g, "")), PNL_OFFSET,
      `${file}.ts encodes with a different offset than settlement.ts`);
  }
});

test("reported PnL bounds match what updateLivePnL enforces", () => {
  const min = solidityConstant("PNL_MIN_BPS");
  const max = solidityConstant("PNL_MAX_BPS");
  // The offset has to carry the whole negative range into unsigned territory.
  assert.ok(min + PNL_OFFSET >= 0, `PnL of ${min}bps would underflow the offset encoding`);
  assert.ok(max + PNL_OFFSET <= Number.MAX_SAFE_INTEGER, "encoded PnL exceeds a safe JS integer");
});

test("the encryption selector matches DuelManager.submitFinalPnL", () => {
  // encryptValue binds the ciphertext to (contract, selector). If the agent's
  // ABI fragment drifts from the contract, validateCiphertext rejects it.
  const agentSelector = new Interface([
    "function submitFinalPnL(uint256 duelId, (uint256 ciphertext, bytes signature) encryptedPnL)",
  ]).getFunction("submitFinalPnL")!.selector;

  assert.ok(
    /function\s+submitFinalPnL\s*\(\s*uint256\s+duelId\s*,\s*itUint64\s+calldata/.test(source),
    "DuelManager.submitFinalPnL no longer takes (uint256, itUint64) — the agent selector is stale",
  );
  // itUint64 encodes as (uint256 ciphertext, bytes signature).
  assert.equal(agentSelector, new Interface([
    "function submitFinalPnL(uint256,(uint256,bytes))",
  ]).getFunction("submitFinalPnL")!.selector);
});

test("setSettlementDelegate still exists — the renter path depends on it", () => {
  // Without it AgentMarketplace cannot nominate the renter, and every rented
  // duel ends in a forfeit the renter cannot prevent.
  assert.ok(/function\s+setSettlementDelegate\s*\(/.test(source),
    "setSettlementDelegate is gone from DuelManager");
  const marketplace = readFileSync(
    join(__dirname, "../../contracts/contracts/AgentMarketplace.sol"), "utf8");
  assert.ok(/duelManager\.setSettlementDelegate\(/.test(marketplace),
    "rentAndDuel no longer nominates the renter as settlement delegate");
});
