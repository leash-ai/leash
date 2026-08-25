/**
 * Leash Agent
 * An AI agent that competes in private trading duels on COTI.
 *
 * Usage:
 *   ts-node agent.ts create          # Create a new duel
 *   ts-node agent.ts join <duelId>   # Join an existing duel
 *   ts-node agent.ts run <duelId>    # Run strategy in an active duel
 */

import dotenv from "dotenv";
import { ethers } from "ethers";
import axios from "axios";
import { MomentumStrategy, PriceData } from "./strategies/momentum";
import { MeanReversionStrategy } from "./strategies/meanReversion";
import { MarketMakerStrategy } from "./strategies/marketMaker";
import { Strategy } from "./strategies/types";
import { warmUpStrategy } from "./strategies/warmup";
import { cotiWallet, submitFinalPnL } from "./coti/settlement";

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────

const COTI_RPC = "https://testnet.coti.io/rpc";
const DUEL_MANAGER_ADDRESS = process.env.DUEL_MANAGER_ADDRESS!;
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY!;
const STRATEGY = (process.env.STRATEGY || "momentum") as "momentum" | "meanReversion" | "marketMaker";
const STAKE_ETH = process.env.STAKE_ETH || "0.01";
const UPDATE_INTERVAL_MS = parseInt(process.env.UPDATE_INTERVAL_MS || "30000"); // 30s default

// ABI (minimal — only what we need)
const DUEL_MANAGER_ABI = [
  "function createDuel(uint256 duration) payable returns (uint256)",
  "function joinDuel(uint256 duelId) payable",
  "function updateLivePnL(uint256 duelId, int256 pnlBps)",
  "function submitFinalPnL(uint256 duelId, (uint256 ciphertext, bytes signature) encryptedPnL)",
  "function resolveDuel(uint256 duelId)",
  "function getDuel(uint256 duelId) view returns (address, address, uint256, uint256, uint256, uint8, address, bool, bool)",
  "function getLivePnL(uint256 duelId) view returns (int256, int256, uint256, uint256)",
  "event DuelCreated(uint256 indexed duelId, address indexed agentA, uint256 stake, uint256 duration)",
  "event DuelJoined(uint256 indexed duelId, address indexed agentB)",
  "event DuelResolved(uint256 indexed duelId, address indexed winner, uint256 prize)",
];

// ─── Price Oracle ──────────────────────────────────────────────────────────────

async function fetchPrices(): Promise<PriceData> {
  try {
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd",
      { timeout: 5000 }
    );
    return {
      BTC: response.data.bitcoin.usd,
      ETH: response.data.ethereum.usd,
      SOL: response.data.solana.usd,
      timestamp: Date.now(),
    };
  } catch {
    // Fallback prices for demo/testing
    console.warn("Price fetch failed, using fallback prices");
    return { BTC: 65000, ETH: 3500, SOL: 150, timestamp: Date.now() };
  }
}

// ─── Agent Loop ────────────────────────────────────────────────────────────────

async function runDuel(duelId: number) {
  const provider = new ethers.JsonRpcProvider(COTI_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(DUEL_MANAGER_ADDRESS, DUEL_MANAGER_ABI, wallet);

  const strategy: Strategy =
    STRATEGY === "momentum"
      ? new MomentumStrategy(1000)
      : STRATEGY === "meanReversion"
      ? new MeanReversionStrategy()
      : new MarketMakerStrategy();

  console.log(`\n🤖 Leash Agent starting`);
  console.log(`   Address  : ${wallet.address}`);
  console.log(`   Strategy : ${STRATEGY}`);
  console.log(`   Duel ID  : ${duelId}`);

  // Fetch initial prices
  let prices = await fetchPrices();
  strategy.addPriceData(prices);
  console.log(`   BTC: $${prices.BTC} | ETH: $${prices.ETH} | SOL: $${prices.SOL}`);

  // Get duel info. Wait for an opponent first: while a duel is Open, DuelManager
  // parks the raw duration in the endTime slot and joinDuel is what converts it
  // to a timestamp. Reading it early yields 1970, so the loop below would exit on
  // its first check and the agent would report nothing while appearing to run.
  let duel = await contract.getDuel(duelId);
  if (Number(duel[5]) === 0) {
    console.log("   Waiting for an opponent to join...");
    const giveUpAt = Date.now() + 10 * 60 * 1000;
    while (Number(duel[5]) === 0 && Date.now() < giveUpAt) {
      await new Promise(r => setTimeout(r, 5000));
      duel = await contract.getDuel(duelId);
    }
  }
  if (Number(duel[5]) !== 1) {
    console.error(`   Duel ${duelId} is not active (state=${duel[5]}) — nothing to run`);
    return;
  }

  const endTime = Number(duel[4]) * 1000; // Convert to ms

  console.log(`   Duel ends: ${new Date(endTime).toISOString()}\n`);

  // Seed the strategy with real recent prices. Cold, momentum needs LOOKBACK=3
  // ticks — ~90s at the default interval — before it can open a position, which
  // on a short duel means both agents report 0.00% the whole way and the tie
  // rule decides it.
  const warm = await warmUpStrategy(strategy);
  console.log(warm.points
    ? `   Warmed up with ${warm.points} historical price points\n`
    : `   Starting cold — no price history (${warm.error ?? "unknown"})\n`);

  let iteration = 0;
  // The value the contract has on record for us — what settlement must match.
  let lastReportedPnlBps = 0;

  while (Date.now() < endTime) {
    iteration++;
    prices = await fetchPrices();
    strategy.addPriceData(prices);

    // Compute trades
    const trades = strategy.computeTrades();

    for (const trade of trades) {
      const price = prices[trade.asset as keyof PriceData] as number;
      strategy.executeTrade(trade.asset, trade.side, trade.sizePercent, price);
      console.log(`📊 Trade: ${trade.side.toUpperCase()} ${trade.asset} @$${price} (${trade.sizePercent}%)`);
    }

    // Compute and report public PnL
    const { publicPnlBps } = strategy.calculatePnLBps(prices);
    const pnlDisplay = (publicPnlBps / 100).toFixed(2);

    console.log(`📈 PnL: ${pnlDisplay}% | Reporting on-chain...`);

    try {
      const tx = await contract.updateLivePnL(duelId, publicPnlBps);
      await tx.wait();
      lastReportedPnlBps = publicPnlBps;
      console.log(`   ✓ PnL reported (${tx.hash.slice(0, 10)}...)`);
    } catch (e: unknown) {
      const err = e as Error;
      if (Date.now() >= endTime) {
        console.log("   🔕 Submissions closed — last reported value stands");
      } else {
        console.error(`   ✗ PnL update failed: ${err.message}`);
      }
    }

    // Wait for next update
    const remaining = endTime - Date.now();
    const waitTime = Math.min(UPDATE_INTERVAL_MS, remaining - 1000);

    if (waitTime > 0) {
      console.log(`   ⏳ Next update in ${Math.round(waitTime / 1000)}s\n`);
      await new Promise((r) => setTimeout(r, waitTime));
    }
  }

  // Duel over. Settle with the encrypted final score.
  //
  // This must be the last value reported with updateLivePnL, not a freshly
  // recomputed one: DuelManager pins the encrypted score to the agent's own last
  // public report in-circuit, and prices move between the two calls.
  console.log("\n⚔️  Duel ended. Settling with encrypted final PnL...");
  console.log(`   Final PnL: ${(lastReportedPnlBps / 100).toFixed(2)}% (matching last live report)`);

  try {
    const signer = await cotiWallet(PRIVATE_KEY, provider, process.env.AES_KEY);
    const hash = await submitFinalPnL(signer, DUEL_MANAGER_ADDRESS, duelId, lastReportedPnlBps);
    console.log(`   ✓ Encrypted score submitted (${hash.slice(0, 10)}…)`);
    console.log("   Once both agents settle, anyone can call resolveDuel().");
  } catch (e: unknown) {
    console.error(`   ✗ Settlement failed: ${(e as Error).message}`);
    console.error("     Without it this agent forfeits when the duel resolves.");
  }
}

async function createDuel() {
  const provider = new ethers.JsonRpcProvider(COTI_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(DUEL_MANAGER_ADDRESS, DUEL_MANAGER_ABI, wallet);

  const duration = parseInt(process.env.DUEL_DURATION || "86400"); // 24h default
  const stake = ethers.parseEther(STAKE_ETH);

  console.log(`\n🎯 Creating duel`);
  console.log(`   Duration : ${duration / 3600}h`);
  console.log(`   Stake    : ${STAKE_ETH} COTI`);

  const tx = await contract.createDuel(duration, { value: stake });
  const receipt = await tx.wait();

  // Parse DuelCreated event
  const event = receipt?.logs.find((log: { topics: string[] }) =>
    log.topics[0] === ethers.id("DuelCreated(uint256,address,uint256,uint256)")
  );

  if (event) {
    const duelId = parseInt(event.topics[1], 16);
    console.log(`\n✅ Duel created! ID: ${duelId}`);
    console.log(`   Share this ID with your opponent to join`);
    console.log(`   Then run: ts-node agent.ts run ${duelId}`);
  }
}

async function joinDuel(duelId: number) {
  const provider = new ethers.JsonRpcProvider(COTI_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(DUEL_MANAGER_ADDRESS, DUEL_MANAGER_ABI, wallet);

  // Get required stake from duel
  const duel = await contract.getDuel(duelId);
  const stake = duel[2];

  console.log(`\n⚔️  Joining duel ${duelId}`);
  console.log(`   Stake required: ${ethers.formatEther(stake)} COTI`);

  const tx = await contract.joinDuel(duelId, { value: stake });
  await tx.wait();

  console.log(`\n✅ Joined duel ${duelId}!`);
  console.log(`   Run: ts-node agent.ts run ${duelId}`);
}

// ─── CLI Entry ─────────────────────────────────────────────────────────────────

async function main() {
  const [, , command, arg] = process.argv;

  if (!PRIVATE_KEY) {
    console.error("AGENT_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  switch (command) {
    case "create":
      await createDuel();
      break;
    case "join":
      if (!arg) { console.error("Usage: ts-node agent.ts join <duelId>"); process.exit(1); }
      await joinDuel(parseInt(arg));
      break;
    case "run":
      if (!arg) { console.error("Usage: ts-node agent.ts run <duelId>"); process.exit(1); }
      await runDuel(parseInt(arg));
      break;
    default:
      console.log("Usage:");
      console.log("  ts-node agent.ts create          # Create a new duel");
      console.log("  ts-node agent.ts join <duelId>   # Join a duel");
      console.log("  ts-node agent.ts run <duelId>    # Run strategy in active duel");
  }
}

main().catch(console.error);
