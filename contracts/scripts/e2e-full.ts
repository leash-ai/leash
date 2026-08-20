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
 */
import { ethers } from "ethers";
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

    // Resolve
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

    // Deliberately submit nothing, then let the duel expire.
    await sleep((DUEL_DURATION + 5) * 1000);

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
