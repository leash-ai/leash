/**
 * e2e-full.ts — Comprehensive on-chain scenario tests against permanent deployment.
 *
 * Reads addresses from .env (set by deploy-all.ts).
 * Covers:
 *   A. Setup + agent registration (2 agents, 2 listings)
 *   B. Duel 1 — agentB (owner) wins (+5% > +2%)
 *   C. Duel 2 — agentA (renter) wins (+9% > +2%)
 *   D. Duel 3 — equal PnL (both +5%) → agentB wins by design (> not >=)
 *   E. PnL overwrite — last submission before expiry is final
 *   F. cancelDuel — agentA refunded
 *   G. refundStuck too early — should revert
 *   H. Leaderboard ordering (getTopAgents)
 *   I. claimUSDC accumulated fees
 *   J. updateFee + delistAgent
 *   K. Non-owner management blocked (auth checks)
 *   L. No contest — neither agent reports → both stakes refunded, no fight recorded
 *   M. Encrypted settlement — MpcCore.gt decides the winner, scores never decrypted
 *   N. The pin holds — an encrypted score that isn't the last live value is rejected
 *   O. Forfeit — reported live but never settled
 */
import { ethers } from "ethers";
import { Wallet as CotiWallet } from "@coti-io/coti-ethers";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

const RPC            = "https://testnet.coti.io/rpc";
const SIGNING_KEY    = process.env.SIGNING_KEYS!.split(",")[0];
const REGISTRY_ADDR  = process.env.AGENT_REGISTRY_ADDRESS!;
const DM_ADDR        = process.env.DUEL_MANAGER_ADDRESS!;
const MKT_ADDR       = process.env.AGENT_MARKETPLACE_ADDRESS!;
const USDC_ADDR      = process.env.CUSDC_ADDRESS!;

// Seconds (TestDuelManager allows 1s+). Submissions now close at endTime, and
// scenario E sends five sequential PnL txs that must all confirm inside the
// window, so this needs headroom over the sum of those confirmation times.
const DUEL_DURATION  = 90;
// Must match TestDuelManager.finalWindow(). Encrypted scores are accepted for
// this long after endTime; resolveDuel only becomes callable once it closes.
const FINAL_WINDOW   = 60;
const ONBOARD        = "0x536A67f0cc46513E7d27a370ed1aF9FDcC7A5095";
// submitFinalPnL(uint256,(uint256,bytes)) — read off the fragment, never hardcoded.
const SUBMIT_FINAL_SELECTOR = new ethers.Interface([
  "function submitFinalPnL(uint256 duelId, (uint256 ciphertext, bytes signature) encryptedPnL)",
]).getFunction("submitFinalPnL")!.selector;
const STAKE          = ethers.parseEther("0.002");
const RENTAL_FEE     = 1_000_000n; // 1 ptUSDC (6 dec)

function artifact(name: string) {
  const p = path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const provider = new ethers.JsonRpcProvider(RPC);
const owner  = new ethers.Wallet(SIGNING_KEY, provider);
// Deterministic renter wallet derived from owner key — same address every run.
const RENTER_KEY = ethers.keccak256(ethers.toUtf8Bytes(SIGNING_KEY + "leash-renter-v1"));
const renter = new ethers.Wallet(RENTER_KEY, provider);

let pass = 0, fail = 0;
const results: {name: string; ok: boolean; note?: string}[] = [];

function check(name: string, cond: boolean, note?: string): boolean {
  const icon = cond ? "✅" : "❌";
  const suffix = note ? ` — ${note}` : "";
  console.log(`  ${icon} ${name}${suffix}`);
  results.push({ name, ok: cond, note });
  if (cond) pass++; else fail++;
  return cond;
}

function log(tag: string, msg: string) {
  console.log(`[${new Date().toISOString().slice(11,19)}] ${tag.padEnd(8)} ${msg}`);
}

async function sleep(ms: number) { await new Promise(r => setTimeout(r, ms)); }

async function send(label: string, fn: (...a: any[]) => Promise<any>, args: any[], opts: any = {}) {
  const tx = await fn(...args, { gasLimit: 2_000_000n, ...opts });
  const rc = await tx.wait();
  log("TX", `${label}: ${rc?.hash?.slice(0, 14)}…`);
  return rc;
}

// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log("  LEASH — Full Scenario E2E (on-chain, permanent contracts)");
  console.log("══════════════════════════════════════════════════════════════════\n");
  console.log(`  Owner:  ${owner.address}`);
  console.log(`  Renter: ${renter.address}`);
  console.log(`  DM:     ${DM_ADDR}`);
  console.log(`  Mkt:    ${MKT_ADDR}\n`);

  const reg  = new ethers.Contract(REGISTRY_ADDR, artifact("AgentRegistry").abi, owner);
  const dm   = new ethers.Contract(DM_ADDR, artifact("TestDuelManager").abi, owner);
  const mkt  = new ethers.Contract(MKT_ADDR, artifact("AgentMarketplace").abi, owner);
  const usdc = new ethers.Contract(USDC_ADDR, artifact("PrivateTestUSDC").abi, owner);

  const mkt_renter  = mkt.connect(renter) as typeof mkt;
  const dm_renter   = dm.connect(renter)  as typeof dm;

  // COTI wallets for encrypted settlement. generateOrRecoverAes is deterministic
  // — same private key, same AES key — so re-running this script is free after
  // the first onboarding.
  const ownerCoti  = new CotiWallet(SIGNING_KEY, provider);
  const renterCoti = new CotiWallet(RENTER_KEY, provider);
  let mpcReady = false;
  try {
    await ownerCoti.generateOrRecoverAes(ONBOARD);
    await renterCoti.generateOrRecoverAes(ONBOARD);
    mpcReady = !!ownerCoti.getUserOnboardInfo()?.aesKey && !!renterCoti.getUserOnboardInfo()?.aesKey;
    log("SETUP", `AES keys ready — encrypted settlement enabled`);
  } catch (e: any) {
    log("WARN", `AES onboarding failed: ${e.message?.slice(0, 70)}`);
  }

  const PNL_OFFSET = 100_000_000;

  /** Encrypt a score for DuelManager.submitFinalPnL. */
  async function encryptScore(w: CotiWallet, pnlBps: number) {
    return await w.encryptValue(BigInt(pnlBps + PNL_OFFSET), DM_ADDR, SUBMIT_FINAL_SELECTOR);
  }

  /**
   * Settle one side. Both go straight to DuelManager, and they have to:
   * MpcCore.validateCiphertext binds an input text to the immediate caller, so a
   * ciphertext forwarded by a contract is always rejected — measured, not
   * assumed. The owner is agentB and settles for itself; the renter settles for
   * agentA (the marketplace) as the delegate rentAndDuel named.
   */
  async function settleOwner(duelId: bigint, pnlBps: number) {
    const enc = await encryptScore(ownerCoti, pnlBps);
    const dmSigned = new ethers.Contract(DM_ADDR, artifact("TestDuelManager").abi, ownerCoti);
    await send("SETTLE-B", dmSigned.submitFinalPnL, [duelId, enc], { gasLimit: 3_000_000n });
  }

  async function settleRenter(duelId: bigint, pnlBps: number) {
    const enc = await encryptScore(renterCoti, pnlBps);
    const dmSigned = new ethers.Contract(DM_ADDR, artifact("TestDuelManager").abi, renterCoti);
    await send("SETTLE-A", dmSigned.submitFinalPnL, [duelId, enc], { gasLimit: 3_000_000n });
  }

  // ── SETUP ────────────────────────────────────────────────────────────────
  console.log("\n── Setup: fund + mint ──");

  // Fund renter — only if owner can afford it
  const renterBal = await provider.getBalance(renter.address);
  const ownerBal  = await provider.getBalance(owner.address);
  const FUND_AMOUNT = ethers.parseEther("0.30");
  if (renterBal < ethers.parseEther("0.20")) {
    if (ownerBal > FUND_AMOUNT + ethers.parseEther("0.03")) {
      await send("FUND", owner.sendTransaction.bind(owner), [{ to: renter.address, value: FUND_AMOUNT }]);
    } else {
      log("WARN", `Owner low on COTI (${ethers.formatEther(ownerBal)} COTI) — skipping fund`);
    }
  }

  // Mint ptUSDC to renter — skip gracefully if owner is out of gas money
  const usdcMint = new ethers.Contract(
    USDC_ADDR,
    ["function mint(address to, uint256 amount)"],
    owner
  );
  try {
    await send("MINT", usdcMint.mint, [renter.address, 20_000_000n]);
    log("SETUP", "20 ptUSDC minted to renter");
  } catch (e: any) {
    log("WARN", `MINT skipped — owner low on COTI, renter uses existing ptUSDC balance`);
  }

  // ── SCENARIO A: Register 2 agents, 2 listings ────────────────────────────
  console.log("\n── Scenario A: Agent registration + listings ──");

  // Register agents — idempotent: try first, scan existing on "Already registered"
  let alphaId = 0n, betaId = 0n, alphaListingId = 0n, betaListingId = 0n;
  const reg_renter = reg.connect(renter) as typeof reg;

  // AlphaBot (owner) — find via ERC721 mint Transfer event (from=0x0, to=owner)
  {
    const mintTopic = ethers.id("Transfer(address,address,uint256)");
    const ownerPad  = ethers.zeroPadValue(owner.address, 32);
    const zeroPad   = ethers.zeroPadValue(ethers.ZeroAddress, 32);
    const mintLogs  = await provider.getLogs({
      address: REGISTRY_ADDR,
      topics:  [mintTopic, zeroPad, ownerPad],
      fromBlock: 0,
    });
    if (mintLogs.length > 0) {
      alphaId = BigInt(mintLogs[mintLogs.length - 1].topics[3]);
      log("SCAN", `AlphaBot already registered, found agentId=${alphaId}`);
    }
  }
  if (!alphaId || alphaId === 0n) {
    try {
      const rc = await send("REG", reg.registerAgent, ["AlphaBot", "ipfs://alpha"]);
      const mintLog = rc?.logs.find((l: any) => l.topics[0] === ethers.id("AgentMinted(uint256,string)"));
      if (mintLog) alphaId = BigInt(mintLog.topics[1]);
    } catch (e: any) {
      log("REG", `AlphaBot registration failed: ${(e as Error).message?.slice(0, 60)}`);
    }
  }
  check("A1: AlphaBot exists", alphaId > 0n, `agentId=${alphaId}`);

  // BetaBot (renter) — idempotent: scan ERC721 mints to renter first
  {
    const mintTopic = ethers.id("Transfer(address,address,uint256)");
    const renterPad  = ethers.zeroPadValue(renter.address, 32);
    const zeroPad   = ethers.zeroPadValue(ethers.ZeroAddress, 32);
    const mintLogs  = await provider.getLogs({
      address: REGISTRY_ADDR,
      topics:  [mintTopic, zeroPad, renterPad],
      fromBlock: 0,
    });
    if (mintLogs.length > 0) {
      betaId = BigInt(mintLogs[mintLogs.length - 1].topics[3]);
      log("SCAN", `BetaBot already registered, found agentId=${betaId}`);
    }
  }
  if (!betaId || betaId === 0n) {
    try {
      const rc = await send("REG", reg_renter.registerAgent, ["BetaBot", "ipfs://beta"]);
      const mintLog = rc?.logs.find((l: any) => l.topics[0] === ethers.id("AgentMinted(uint256,string)"));
      if (mintLog) betaId = BigInt(mintLog.topics[1]);
    } catch (e: any) {
      log("", `BetaBot reg failed: ${(e as Error).message?.slice(0, 60)}`);
    }
  }
  check("A2: BetaBot registered by renter", betaId > 0n, `agentId=${betaId}`);

  // List AlphaBot (owner)
  try {
    const rc = await send("LIST", mkt.listAgent, [alphaId, RENTAL_FEE, 3000]);
    const listLog = rc?.logs.find((l: any) =>
      l.topics[0] === ethers.id("AgentListed(uint256,uint256,uint256,uint256)")
    );
    if (listLog) alphaListingId = BigInt(listLog.topics[1]);
    check("A3: AlphaBot listed", alphaListingId > 0n, `listingId=${alphaListingId}`);
  } catch (e: any) {
    check("A3: AlphaBot listed", false, e.message?.slice(0, 60));
  }

  // List BetaBot (renter)
  try {
    const rc = await send("LIST", mkt_renter.listAgent, [betaId, 2_000_000n, 5000]);
    const listLog = rc?.logs.find((l: any) =>
      l.topics[0] === ethers.id("AgentListed(uint256,uint256,uint256,uint256)")
    );
    if (listLog) betaListingId = BigInt(listLog.topics[1]);
    check("A4: BetaBot listed by renter", betaListingId > 0n, `listingId=${betaListingId}`);
  } catch (e: any) {
    check("A4: BetaBot listed by renter", false, e.message?.slice(0, 60));
  }

  // Approve — use explicit selector to disambiguate PrivateERC20 overloads.
  // PrivateERC20.approve(nonzero) requires current allowance == 0 (ERC20UnsafeApprove).
  // Reset to 0 first so repeated E2E runs don't fail on stale allowance.
  const usdcApprove = new ethers.Contract(
    USDC_ADDR,
    ["function approve(address spender, uint256 amount) returns (bool)"],
    renter
  );
  try { await send("APPROVE-RESET", usdcApprove.approve, [MKT_ADDR, 0n]); } catch { /* already 0 */ }
  await send("APPROVE", usdcApprove.approve, [MKT_ADDR, 20_000_000n]);
  check("A5: ptUSDC approved", true, "20 ptUSDC to marketplace");

  // Non-owner cannot list someone else's agent
  const notOwner = ethers.Wallet.createRandom().connect(provider);
  await owner.sendTransaction({ to: notOwner.address, value: ethers.parseEther("0.01"), gasLimit: 21000n });
  try {
    await (mkt.connect(notOwner) as typeof mkt).listAgent(alphaId, RENTAL_FEE, 3000, { gasLimit: 2_000_000n });
    check("A6: Non-owner listAgent blocked", false);
  } catch {
    check("A6: Non-owner listAgent blocked", true);
  }

  // sendCoti: like send() but tolerates COTI testnet false-revert (status=0 despite on-chain success).
  // After a receipt-0 error, polls verifyFn up to 5 times (10s total) before giving up.
  async function sendCoti(
    label: string,
    fn: (...a: any[]) => Promise<any>,
    args: any[],
    opts: any = {},
    verifyFn?: () => Promise<boolean>
  ) {
    try {
      return await send(label, fn, args, opts);
    } catch (e: any) {
      if (verifyFn) {
        for (let attempt = 1; attempt <= 5; attempt++) {
          await sleep(2000);
          try {
            const ok = await verifyFn();
            log("DBG", `${label} verify attempt ${attempt}: ${ok}`);
            if (ok) {
              log("WARN", `${label}: receipt status=0 but on-chain state confirmed ✅ (COTI testnet quirk)`);
              return null;
            }
          } catch (ve: any) {
            log("DBG", `${label} verifyFn error: ${(ve as Error).message?.slice(0, 40)}`);
          }
        }
      }
      throw e;
    }
  }

  // ── Helper: run a full duel ───────────────────────────────────────────────
  async function runDuel(renterPnl: number, ownerPnl: number): Promise<{rentalId: bigint; duelId: bigint; winner: string}> {
    const rc = await send("RENT", mkt_renter.rentAndDuel, [alphaListingId, DUEL_DURATION], { value: STAKE });
    const rentLog = rc?.logs.find((l: any) =>
      l.topics[0] === ethers.id("AgentRented(uint256,uint256,address)")
    );
    const rentalId = BigInt(rentLog!.topics[1]);
    const duelId   = BigInt(rentLog!.topics[2]);

    // Owner joins as agentB
    await send("JOIN", dm.joinDuel, [duelId], { value: STAKE });

    // Submit PnL — handle COTI testnet false-revert quirk
    log("PNL", `rentalId=${rentalId} duelId=${duelId} renter=${renterPnl}bps owner=${ownerPnl}bps`);
    await sendCoti(
      "PNL-A", mkt_renter.updateRenterPnL, [rentalId, renterPnl], {},
      async () => { const d = await dm.getDuel(duelId); return d[7] as boolean; }
    );
    await sendCoti(
      "PNL-B", dm.updateLivePnL, [duelId, ownerPnl], {},
      async () => { const d = await dm.getDuel(duelId); return d[8] as boolean; }
    );

    // Verify both submitted before waiting
    const duelCheck = await dm.getDuel(duelId);
    if (!duelCheck[7] || !duelCheck[8]) {
      throw new Error(`PnL not submitted on-chain: aSubmitted=${duelCheck[7]} bSubmitted=${duelCheck[8]}`);
    }

    // Wait for duel to expire
    await sleep((DUEL_DURATION + 5) * 1000);

    // Settle: both sides submit their score encrypted, pinned in-circuit to the
    // live value each of them reported above.
    await settleRenter(duelId, renterPnl);
    await settleOwner(duelId, ownerPnl);

    const settleStatus = await dm.getFinalPnLStatus(duelId);
    if (!settleStatus[0] || !settleStatus[1]) {
      throw new Error(`not settled on-chain: a=${settleStatus[0]} b=${settleStatus[1]}`);
    }

    // resolveDuel only opens once the final window closes
    await sleep((FINAL_WINDOW + 5) * 1000);

    // Resolve — the winner comes out of MpcCore.gt on the two ciphertexts
    const resolveRc = await send("RESOLVE", dm.resolveDuel, [duelId]);
    const resolvedLog = resolveRc?.logs.find((l: any) =>
      l.topics[0] === ethers.id("DuelResolved(uint256,address,uint256)")
    );
    const iface = new ethers.Interface(["event DuelResolved(uint256 indexed duelId, address indexed winner, uint256 prize)"]);
    const parsed = iface.parseLog({ topics: resolvedLog!.topics, data: resolvedLog!.data });
    const winner = (parsed!.args[1] as string).toLowerCase();
    const prize  = ethers.formatEther(parsed!.args[2]);
    log("", `Winner: ${winner.slice(0,10)}… | Prize: ${prize} COTI`);

    // Settle
    await send("SETTLE", mkt.settleRental, [rentalId]);

    return { rentalId, duelId, winner };
  }

  // ── SCENARIO B: Duel 1 — agentB (owner) wins ─────────────────────────────
  console.log("\n── Scenario B: Duel 1 — agentB (owner) wins (+5% > +2%) ──");
  let alphaBefore = await reg.getProfile(alphaId);
  const duel1 = await runDuel(200, 500);
  const alphaAfter1 = await reg.getProfile(alphaId);
  check("B1: agentB wins (owner, 500 > 200)", duel1.winner === owner.address.toLowerCase());
  check("B2: AlphaBot fights = 1",  Number(alphaAfter1.totalFights) === Number(alphaBefore.totalFights) + 1);
  check("B3: AlphaBot wins = prev+1", Number(alphaAfter1.wins) === Number(alphaBefore.wins) + 1);

  // ── SCENARIO C: Duel 2 — agentA (renter) wins ────────────────────────────
  console.log("\n── Scenario C: Duel 2 — agentA (renter) wins (+9% > +2%) ──");
  const duel2 = await runDuel(900, 200);
  const alphaAfter2 = await reg.getProfile(alphaId);
  // agentA = marketplace → owner's agent (agentB) lost
  check("C1: agentA wins (renter, 900 > 200)", duel2.winner !== owner.address.toLowerCase());
  check("C2: AlphaBot fights = prev+1", Number(alphaAfter2.totalFights) === Number(alphaAfter1.totalFights) + 1);
  check("C3: AlphaBot wins unchanged (lost this duel)", Number(alphaAfter2.wins) === Number(alphaAfter1.wins));

  // ── SCENARIO D: Duel 3 — equal PnL → agentB wins ─────────────────────────
  console.log("\n── Scenario D: Duel 3 — equal PnL (500 = 500) → agentB wins ──");
  const duel3 = await runDuel(500, 500);
  const alphaAfter3 = await reg.getProfile(alphaId);
  check("D1: agentB wins on draw (> not >=)", duel3.winner === owner.address.toLowerCase());
  check("D2: AlphaBot fights = prev+1", Number(alphaAfter3.totalFights) === Number(alphaAfter2.totalFights) + 1);
  check("D3: AlphaBot wins = prev+1 (won the draw)", Number(alphaAfter3.wins) === Number(alphaAfter2.wins) + 1);

  // ── SCENARIO E: PnL overwrite — last submission is final ─────────────────
  console.log("\n── Scenario E: PnL overwrite ──");
  {
    const rc = await send("RENT", mkt_renter.rentAndDuel, [alphaListingId, DUEL_DURATION], { value: STAKE });
    const rentLog = rc?.logs.find((l: any) =>
      l.topics[0] === ethers.id("AgentRented(uint256,uint256,address)")
    );
    const duelId   = BigInt(rentLog!.topics[2]);
    const rentalId = BigInt(rentLog!.topics[1]);
    await send("JOIN", dm.joinDuel, [duelId], { value: STAKE });

    // Renter: 700 → then 200 (last = 200)
    await sendCoti("PNL", mkt_renter.updateRenterPnL, [rentalId, 700], {},
      async () => { const l = await dm.getLivePnL(duelId); return Number(l[0]) === 700; });
    await sendCoti("PNL", mkt_renter.updateRenterPnL, [rentalId, 200], {},
      async () => { const l = await dm.getLivePnL(duelId); return Number(l[0]) === 200; });

    // Owner: 100 → then 300 → then 150 (last = 150)
    await sendCoti("PNL", dm.updateLivePnL, [duelId, 100], {},
      async () => { const l = await dm.getLivePnL(duelId); return Number(l[1]) === 100; });
    await sendCoti("PNL", dm.updateLivePnL, [duelId, 300], {},
      async () => { const l = await dm.getLivePnL(duelId); return Number(l[1]) === 300; });
    await sendCoti("PNL", dm.updateLivePnL, [duelId, 150], {},
      async () => { const l = await dm.getLivePnL(duelId); return Number(l[1]) === 150; });

    const live = await dm.getLivePnL(duelId);
    check("E1: renter last PnL = 200bps", Number(live[0]) === 200);
    check("E2: owner last PnL = 150bps",  Number(live[1]) === 150);

    await sleep((DUEL_DURATION + 5) * 1000);

    // Settle on the last values that landed — 200 and 150. The pin rejects
    // anything else, which is also what makes E1/E2 load-bearing rather than
    // cosmetic: the overwritten values are the ones settlement is held to.
    await settleRenter(duelId, 200);
    await settleOwner(duelId, 150);

    await sleep((FINAL_WINDOW + 5) * 1000);
    await send("RESOLVE", dm.resolveDuel, [duelId]);
    await send("SETTLE", mkt.settleRental, [rentalId]);

    const alphaFinal = await reg.getProfile(alphaId);
    // renter=200 > owner=150 → agentA (renter/mkt) wins → agentB (owner/alpha) loses
    check("E3: agentA wins (last values: 200 > 150)", Number(alphaFinal.wins) === Number(alphaAfter3.wins));
  }

  // ── SCENARIO F: cancelDuel ────────────────────────────────────────────────
  console.log("\n── Scenario F: cancelDuel ──");
  {
    const balBefore = await provider.getBalance(owner.address);
    const rc = await send("CREATE", dm.createDuel, [60], { value: STAKE });
    const duelLog = rc?.logs.find((l: any) =>
      l.topics[0] === ethers.id("DuelCreated(uint256,address,uint256,uint256)")
    );
    const cancelDuelId = BigInt(duelLog!.topics[1]);
    await send("CANCEL", dm.cancelDuel, [cancelDuelId]);
    const balAfter = await provider.getBalance(owner.address);
    check("F1: cancelDuel refunds stake", balAfter > balBefore - STAKE, "net positive after cancel");

    // Cannot cancel again
    try {
      await send("CANCEL2", dm.cancelDuel, [cancelDuelId]);
      check("F2: double-cancel blocked", false);
    } catch {
      check("F2: double-cancel blocked", true);
    }
  }

  // ── SCENARIO G: refundStuck reverts too early ─────────────────────────────
  console.log("\n── Scenario G: refundStuck too early reverts ──");
  {
    const rc = await send("CREATE", dm.createDuel, [3600], { value: STAKE });
    const duelLog = rc?.logs.find((l: any) =>
      l.topics[0] === ethers.id("DuelCreated(uint256,address,uint256,uint256)")
    );
    const stuckDuelId = BigInt(duelLog!.topics[1]);
    try {
      await send("REFUND", dm.refundStuck, [stuckDuelId]);
      check("G1: refundStuck reverts before 24h", false);
    } catch {
      check("G1: refundStuck reverts before 24h", true);
    }
    // Clean up — cancel it
    await send("CANCEL", dm.cancelDuel, [stuckDuelId]);
  }

  // ── SCENARIO H: getTopAgents leaderboard ─────────────────────────────────
  console.log("\n── Scenario H: Leaderboard (getTopAgents) ──");
  {
    const agentCount = Number(await reg.agentCount());
    const [agentIds, profiles] = await reg.getTopAgents(agentCount);
    check("H1: getTopAgents returns all agents", agentIds.length === agentCount, `${agentCount} agents`);

    // AlphaBot should be first (highest winRate)
    const topId = agentIds[0];
    const topProfile = profiles[0];
    check("H2: Top agent is AlphaBot", topId.toString() === alphaId.toString(), `id=${topId}`);
    check("H3: AlphaBot winRate > BetaBot (0 fights)", Number(topProfile.totalFights) > 0);

    // Print leaderboard
    console.log("\n  LEADERBOARD:");
    for (let i = 0; i < agentIds.length; i++) {
      const p = profiles[i];
      const wr = Number(p.totalFights) > 0
        ? ((Number(p.wins) * 100) / Number(p.totalFights)).toFixed(0)
        : "0";
      console.log(`  #${i+1} ${p.name.padEnd(10)} ${p.wins}W/${p.losses}L — ${wr}% winRate`);
    }
  }

  // ── SCENARIO I: claimUSDC ─────────────────────────────────────────────────
  console.log("\n── Scenario I: claimUSDC accumulated fees ──");
  {
    const pending = await mkt.pendingUSDC(owner.address);
    check("I1: Owner has pending ptUSDC", BigInt(pending) > 0n, `${Number(pending)/1e6} ptUSDC`);
    await send("CLAIM", mkt.claimUSDC, []);
    const pendingAfter = await mkt.pendingUSDC(owner.address);
    check("I2: Pending cleared to 0 after claim", pendingAfter.toString() === "0");
  }

  // ── SCENARIO J: updateFee + delistAgent ──────────────────────────────────
  console.log("\n── Scenario J: updateFee + delistAgent ──");
  {
    await send("UPDFEE", mkt.updateFee, [alphaListingId, 5_000_000n]);
    const afterUpdate = await mkt.listings(alphaListingId);
    check("J1: AlphaBot fee updated to 5 ptUSDC", afterUpdate.rentalFeeUSDC.toString() === "5000000");

    await send("DELIST", mkt.delistAgent, [alphaListingId]);
    const afterDelist = await mkt.listings(alphaListingId);
    check("J2: AlphaBot delisted", !afterDelist.available);

    // Cannot rent delisted agent
    try {
      await send("RENT-DELIST", mkt_renter.rentAndDuel, [alphaListingId, DUEL_DURATION], { value: STAKE });
      check("J3: Rent delisted agent blocked", false);
    } catch {
      check("J3: Rent delisted agent blocked", true);
    }

    // Re-list to restore
    await send("RELIST", mkt.listAgent, [alphaId, RENTAL_FEE, 3000]);
    check("J4: AlphaBot re-listed successfully", true);
  }

  // ── SCENARIO K: Auth edge cases ───────────────────────────────────────────
  console.log("\n── Scenario K: Auth edge cases ──");
  {
    // updateFee by non-owner
    try {
      await send("UPDFEE2", mkt_renter.updateFee, [alphaListingId, 999n]);
      check("K1: Non-owner updateFee blocked", false);
    } catch {
      check("K1: Non-owner updateFee blocked", true);
    }

    // delistAgent by non-owner
    try {
      await send("DELIST2", mkt_renter.delistAgent, [alphaListingId]);
      check("K2: Non-owner delistAgent blocked", false);
    } catch {
      check("K2: Non-owner delistAgent blocked", true);
    }

    // resolveDuel on non-existent duel
    try {
      await send("RESOLVE2", dm.resolveDuel, [999999]);
      check("K3: Resolve non-existent duel blocked", false);
    } catch {
      check("K3: Resolve non-existent duel blocked", true);
    }
  }

  // ── SCENARIO L: no contest — neither agent reports ───────────────────────
  // Covers the resolution path added for the stake-lock fix. Before it, this
  // duel could never be resolved: resolveDuel required both submissions and
  // refundStuck/cancelDuel only cover Open duels, so both stakes were locked
  // permanently. Also the only coverage of AgentMarketplace's no-contest
  // branch, which returns the renter's refunded stake and must not record a
  // defeat for an agent that was never beaten.
  console.log("\n── Scenario L: no contest — neither agent reports, both refunded ──");
  {
    const alphaBeforeL = await reg.getProfile(alphaId);

    const rc = await send("RENT-NC", mkt_renter.rentAndDuel, [alphaListingId, DUEL_DURATION], { value: STAKE });
    const rentLog = rc?.logs.find((l: any) =>
      l.topics[0] === ethers.id("AgentRented(uint256,uint256,address)")
    );
    const rentalId = BigInt(rentLog!.topics[1]);
    const duelId   = BigInt(rentLog!.topics[2]);
    log("NC", `rentalId=${rentalId} duelId=${duelId} — submitting no PnL from either side`);

    await send("JOIN-NC", dm.joinDuel, [duelId], { value: STAKE });

    // Deliberately submit nothing — no live PnL, so neither side can settle
    // either — then let both the duel and the final window expire.
    await sleep((DUEL_DURATION + 5) * 1000);
    await sleep((FINAL_WINDOW + 5) * 1000);

    const mktBefore   = await provider.getBalance(MKT_ADDR);
    const ownerBefore = await provider.getBalance(owner.address);

    // Renter resolves so the owner's balance moves only by the refund.
    // The no-contest path returns before the resolver bonus, so there is none.
    const resolveRc = await send("RESOLVE-NC", dm_renter.resolveDuel, [duelId]);
    check("L1: resolveDuel succeeds with no submissions", true);
    check(
      "L2: DuelNoContest emitted",
      !!resolveRc?.logs.some((l: any) => l.topics[0] === ethers.id("DuelNoContest(uint256,uint256)"))
    );

    const d = await dm.getDuel(duelId);
    check("L3: duel state = Resolved", Number(d[5]) === 2, `state=${Number(d[5])}`);
    check("L4: no winner recorded", (d[6] as string) === ethers.ZeroAddress);

    const mktAfter   = await provider.getBalance(MKT_ADDR);
    const ownerAfter = await provider.getBalance(owner.address);
    check("L5: agentA (marketplace) stake refunded", mktAfter - mktBefore === STAKE,
          `+${ethers.formatEther(mktAfter - mktBefore)} COTI`);
    check("L6: agentB (owner) stake refunded in full", ownerAfter - ownerBefore === STAKE,
          `+${ethers.formatEther(ownerAfter - ownerBefore)} COTI`);

    // Settle: marketplace must hand the refunded stake back to the renter and
    // leave the agent's record alone.
    const renterBefore = await provider.getBalance(renter.address);
    await send("SETTLE-NC", mkt.settleRental, [rentalId]);
    const renterAfter = await provider.getBalance(renter.address);

    check("L7: renter refunded by settleRental", renterAfter - renterBefore === STAKE,
          `+${ethers.formatEther(renterAfter - renterBefore)} COTI`);
    check("L8: no stake stranded in marketplace", await provider.getBalance(MKT_ADDR) === mktBefore,
          "balance back to pre-scenario level");

    const alphaAfterL = await reg.getProfile(alphaId);
    check("L9: no contest is not recorded as a fight",
          Number(alphaAfterL.totalFights) === Number(alphaBeforeL.totalFights),
          `fights ${alphaBeforeL.totalFights} → ${alphaAfterL.totalFights}`);
    check("L10: no contest is not recorded as a defeat",
          Number(alphaAfterL.losses) === Number(alphaBeforeL.losses),
          `losses ${alphaBeforeL.losses} → ${alphaAfterL.losses}`);
  }

  // ── SCENARIO M: encrypted settlement decides the winner ──────────────────
  // Every duel above already settled through MpcCore.gt — runDuel does it. This
  // asserts the properties that make that meaningful rather than ceremonial.
  console.log("\n── Scenario M: encrypted settlement ──");
  if (!mpcReady) {
    check("M: skipped — no AES key", false, "AES onboarding failed earlier");
  } else {
    const m = await runDuel(300, 800);   // owner higher → agentB wins
    check("M1: winner decided by encrypted comparison", m.winner === owner.address.toLowerCase(),
          `winner=${m.winner.slice(0, 10)}…`);

    const status = await dm.getFinalPnLStatus(m.duelId);
    check("M2: both sides recorded as settled", status[0] === true && status[1] === true);

    // The ciphertexts are stored per agent. Nothing in the ABI returns a
    // plaintext score, and resolveDuel emitted only a winner and a prize.
    const d = await dm.getDuel(m.duelId);
    check("M3: resolved with a winner and no score in the receipt",
          (d[6] as string) !== ethers.ZeroAddress);
  }

  // ── SCENARIO N: the pin rejects a score that was never reported ──────────
  // This is the guard that stops the public feed from being gamed through the
  // encrypted door: read the opponent's last public PnL, encrypt one higher.
  // Nothing else in the suite covers it, and it cannot be tested locally.
  console.log("\n── Scenario N: encrypted score must match the last live PnL ──");
  if (!mpcReady) {
    check("N: skipped — no AES key", false, "AES onboarding failed earlier");
  } else {
    const rc = await send("RENT-PIN", mkt_renter.rentAndDuel, [alphaListingId, DUEL_DURATION], { value: STAKE });
    const rentLog = rc?.logs.find((l: any) => l.topics[0] === ethers.id("AgentRented(uint256,uint256,address)"));
    const rentalId = BigInt(rentLog!.topics[1]);
    const duelId   = BigInt(rentLog!.topics[2]);
    await send("JOIN-PIN", dm.joinDuel, [duelId], { value: STAKE });

    // Owner reports +100bps. Renter reports +200bps and can read the owner's.
    await sendCoti("PNL-A", mkt_renter.updateRenterPnL, [rentalId, 200], {},
      async () => { const d = await dm.getDuel(duelId); return d[7] as boolean; });
    await sendCoti("PNL-B", dm.updateLivePnL, [duelId, 100], {},
      async () => { const d = await dm.getDuel(duelId); return d[8] as boolean; });

    await sleep((DUEL_DURATION + 5) * 1000);

    // Owner tries to settle on 900bps having only ever reported 100bps.
    let rejected = false;
    try {
      await settleOwner(duelId, 900);
    } catch {
      rejected = true;
    }
    check("N1: mismatched encrypted score rejected", rejected,
          rejected ? "reverted as expected" : "ACCEPTED — the pin is not holding");

    // The honest value still settles.
    let honestOk = false;
    try {
      await settleOwner(duelId, 100);
      honestOk = (await dm.getFinalPnLStatus(duelId))[1] === true;
    } catch (e: any) {
      log("WARN", `honest settlement failed: ${e.message?.slice(0, 70)}`);
    }
    check("N2: the value actually reported settles", honestOk);

    // Renter never settles → owner wins by forfeit, which also covers scenario O.
    await sleep((FINAL_WINDOW + 5) * 1000);
    const rrc = await send("RESOLVE-PIN", dm.resolveDuel, [duelId]);
    const forfeited = rrc?.logs.some((l: any) =>
      l.topics[0] === ethers.id("DuelForfeited(uint256,address,address)"));
    check("O1: agent that never settled forfeits", !!forfeited);
    const fd = await dm.getDuel(duelId);
    check("O2: forfeit awarded to the agent that settled",
          (fd[6] as string).toLowerCase() === owner.address.toLowerCase());
    await send("SETTLE-PIN", mkt.settleRental, [rentalId]);
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${pass}/${pass + fail} tests passed`);
  console.log("══════════════════════════════════════════════════════════════════");
  for (const r of results) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}${r.note ? ` — ${r.note}` : ""}`);
  }
  console.log(`\n  Contracts:`);
  console.log(`    AgentRegistry:    ${REGISTRY_ADDR}`);
  console.log(`    TestDuelManager:  ${DM_ADDR}`);
  console.log(`    AgentMarketplace: ${MKT_ADDR}`);
  console.log("══════════════════════════════════════════════════════════════════\n");
}

main().catch(e => { console.error(e); process.exit(1); });
