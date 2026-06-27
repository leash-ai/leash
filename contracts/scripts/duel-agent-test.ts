/**
 * Full agent test:
 * 1. Create 5-min duel (OPEN, timer not started)
 * 2. Set strategy via agent API
 * 3. Join duel (timer starts)
 * 4. Immediately start AI agent
 * 5. Print live feed events
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const DM_ABI = [
  "function createDuel(uint256 duration) external payable returns (uint256)",
  "function joinDuel(uint256 duelId) external payable",
  "function getLivePnL(uint256 duelId) view returns (int256 pnlA, int256 pnlB, uint256 updatedA, uint256 updatedB)",
  "event DuelCreated(uint256 indexed duelId, address indexed agentA, uint256 stake, uint256 duration)",
];

const AGENT_URL = "http://localhost:3001";

async function agentChat(duelId: number, message: string) {
  const r = await fetch(`${AGENT_URL}/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ duelId, message }),
  });
  return r.json();
}

async function startAgent(duelId: number, signerKey: string) {
  const r = await fetch(`${AGENT_URL}/agent/duel/${duelId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signerKey }),
  });
  return r.json();
}

async function getStatus(duelId: number) {
  const r = await fetch(`${AGENT_URL}/agent/duel/${duelId}/status`);
  return r.json();
}

async function main() {
  const provider = new ethers.JsonRpcProvider("https://testnet.coti.io/rpc");
  const SIGNING_KEY = process.env.SIGNING_KEYS!;
  const owner = new ethers.Wallet(SIGNING_KEY, provider);
  const RENTER_KEY = ethers.keccak256(ethers.toUtf8Bytes(SIGNING_KEY + "leash-renter-v1"));
  const renter = new ethers.Wallet(RENTER_KEY, provider);

  const dmOwner = new ethers.Contract(process.env.DUEL_MANAGER_ADDRESS!, DM_ABI, owner);
  const dmRenter = new ethers.Contract(process.env.DUEL_MANAGER_ADDRESS!, DM_ABI, renter);
  const dmRead = new ethers.Contract(process.env.DUEL_MANAGER_ADDRESS!, DM_ABI, provider);

  const STAKE = ethers.parseEther("0.1");
  const DURATION = 300n; // 5 minutes

  // 1. Create duel (timer NOT started yet — no opponent)
  console.log("\n🥊 Creating 5-min duel (0.1 COTI)...");
  const tx1 = await dmOwner.createDuel(DURATION, { value: STAKE, gasLimit: 500_000n });
  const rc1 = await tx1.wait();
  const log = rc1?.logs.find((l: any) =>
    l.topics[0] === ethers.id("DuelCreated(uint256,address,uint256,uint256)")
  );
  const duelId = log ? Number(BigInt(log.topics[1])) : 0;
  if (!duelId) throw new Error("Could not get duelId from logs");
  console.log(`✅ Duel #${duelId} created (OPEN — timer not started)`);

  // 2. Set strategy via agent chat
  console.log("\n💬 Setting agent strategy...");
  const chatReply = await agentChat(duelId,
    "Buy BTC 50% and ETH 30% immediately. Hold SOL 20% as hedge. Sell if any position drops 3%. Go aggressive."
  );
  console.log(`🤖 Agent: "${chatReply.reply?.slice(0, 100)}..."`);
  console.log(`📋 Strategy locked: ${chatReply.strategy}`);

  // 3. Join duel (timer starts NOW)
  console.log("\n⚡ Renter joining — timer starts...");
  const tx2 = await dmRenter.joinDuel(duelId, { value: STAKE, gasLimit: 500_000n });
  await tx2.wait();
  const joinTime = Date.now();
  console.log(`✅ Duel #${duelId} now ACTIVE — 5 minutes on the clock`);

  // 4. Start AI agent for owner (agentA) — IMMEDIATE
  console.log("\n🚀 Starting AI agent for agentA...");
  const startResult = await startAgent(duelId, SIGNING_KEY);
  console.log(`   Agent: ${JSON.stringify(startResult)}`);

  // 5. Run competing renter bot in parallel
  const dmRenterBot = new ethers.Contract(
    process.env.DUEL_MANAGER_ADDRESS!,
    ["function updateLivePnL(uint256,int256) external", "function getDuel(uint256) view returns (address,address,uint256,uint256,uint256,uint8,address,bool,bool,uint256)"],
    renter
  );

  console.log("\n🤖 Both agents running. Watching live feed...\n");
  console.log("─".repeat(60));

  let renterPnl = 0;
  let lastStatus: any = null;

  // Poll every 15s for 5 min, also run renter bot ticks
  const totalMs = 300_000;
  const pollInterval = 15_000;
  const iterations = Math.floor(totalMs / pollInterval);

  for (let i = 0; i < iterations; i++) {
    await new Promise(r => setTimeout(r, pollInterval));

    const elapsed = Math.round((Date.now() - joinTime) / 1000);
    const remaining = 300 - elapsed;

    // Poll agent status
    const status = await getStatus(duelId);

    // Renter bot: submit PnL every other tick
    if (i % 2 === 0) {
      renterPnl += Math.floor(Math.random() * 100 + 30); // +30 to +130 bps
      try {
        const tx = await dmRenterBot.updateLivePnL(duelId, BigInt(renterPnl), { gasLimit: 200_000n });
        await tx.wait();
        console.log(`⚔️  [${elapsed}s] agentB PnL submitted: +${renterPnl}bps`);
      } catch (e: any) {
        console.log(`⚠️  [${elapsed}s] agentB tx error: ${e.message?.slice(0, 60)}`);
      }
    }

    // Get live on-chain PnL
    let pnlA = 0, pnlB = 0;
    try {
      const pnl = await dmRead.getLivePnL(duelId);
      pnlA = Number(pnl[0]);
      pnlB = Number(pnl[1]);
    } catch {}

    const portfolio = status.portfolio;
    const portfolioLine = portfolio && Object.keys(portfolio.positions || {}).length > 0
      ? `Portfolio: ${JSON.stringify(portfolio.positions).slice(0, 60)}`
      : "Portfolio: (loading)";

    console.log(`📊 [${elapsed}s] agentA=${pnlA}bps | agentB=${pnlB}bps | running=${status.running} | ${remaining}s left`);
    console.log(`   ${portfolioLine}`);
    console.log();

    if (remaining <= 5) {
      console.log("⏱  Time up!");
      break;
    }
  }

  // Final result
  const pnl = await dmRead.getLivePnL(duelId);
  const pnlA = Number(pnl[0]);
  const pnlB = Number(pnl[1]);

  console.log("─".repeat(60));
  console.log(`🏆 FINAL: agentA=${pnlA}bps | agentB=${pnlB}bps`);
  if (pnlA > pnlB) console.log("🥇 Winner: agentA (AI agent wins!)");
  else if (pnlB > pnlA) console.log("🥇 Winner: agentB (Renter bot wins!)");
  else console.log("🤝 Draw → agentB wins on tie");

  console.log(`\n👉 Watch live: http://localhost:3000/duel/${duelId}`);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
