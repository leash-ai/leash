/**
 * Renter Listener — background daemon for renters.
 *
 * When you rent an agent and create a duel:
 *   1. Watches for your own AgentRented events
 *   2. Runs a trading strategy off-chain (private — never on-chain)
 *   3. Submits live PnL via AgentMarketplace.updateRenterPnL() every UPDATE_MS
 *
 * You are agentA in the duel (proxied through the marketplace contract).
 * The owner's agent (agentB) runs in rentalListener.ts on their machine.
 *
 * Usage: ts-node renterListener.ts
 *
 * Required env vars:
 *   RENTER_PRIVATE_KEY          — your (renter's) wallet private key
 *   AGENT_MARKETPLACE_ADDRESS
 *   DUEL_MANAGER_ADDRESS
 *
 * Optional:
 *   STRATEGY            — momentum | meanReversion | marketMaker (default: momentum)
 *   UPDATE_INTERVAL_MS  — how often to post PnL (default: 30000ms)
 */
import { ethers } from "ethers";
import dotenv from "dotenv";
import axios from "axios";
import { MomentumStrategy, PriceData } from "./strategies/momentum";
import { MeanReversionStrategy } from "./strategies/meanReversion";
import { MarketMakerStrategy } from "./strategies/marketMaker";

dotenv.config();

const RPC              = "https://testnet.coti.io/rpc";
const PRIVATE_KEY      = process.env.RENTER_PRIVATE_KEY!;
const MARKETPLACE_ADDR = process.env.AGENT_MARKETPLACE_ADDRESS!;
const DUEL_MANAGER_ADDR= process.env.DUEL_MANAGER_ADDRESS!;
const STRATEGY         = (process.env.STRATEGY || "momentum") as "momentum" | "meanReversion" | "marketMaker";
const UPDATE_MS        = parseInt(process.env.UPDATE_INTERVAL_MS || "30000");

const MARKETPLACE_ABI = [
  "event AgentRented(uint256 indexed rentalId, uint256 indexed duelId, address indexed renter)",
  "function rentals(uint256) view returns (uint256,uint256,uint256,address,address,uint256,uint256,uint256,bool)",
  "function updateRenterPnL(uint256 rentalId, int256 pnlBps)",
];

const DUEL_ABI = [
  "function getDuel(uint256 duelId) view returns (address,address,uint256,uint256,uint256,uint8,address,bool,bool,uint256)",
];

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function fetchPrices(): Promise<PriceData> {
  try {
    const r = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd",
      { timeout: 5000 }
    );
    return { BTC: r.data.bitcoin.usd, ETH: r.data.ethereum.usd, SOL: r.data.solana.usd, timestamp: Date.now() };
  } catch {
    return { BTC: 65000, ETH: 3500, SOL: 150, timestamp: Date.now() };
  }
}

function makeStrategy(name: string) {
  if (name === "meanReversion") return new MeanReversionStrategy();
  if (name === "marketMaker")   return new MarketMakerStrategy();
  return new MomentumStrategy(1000);
}

async function handleRental(rentalId: bigint, duelId: bigint, wallet: ethers.Wallet) {
  const provider = wallet.provider as ethers.JsonRpcProvider;
  const marketplace = new ethers.Contract(MARKETPLACE_ADDR, MARKETPLACE_ABI, wallet);
  const dm          = new ethers.Contract(DUEL_MANAGER_ADDR, DUEL_ABI, provider);

  log(`🔔 Rental #${rentalId} — watching duel #${duelId}`);

  const duelData = await dm.getDuel(duelId);
  const endTime  = Number(duelData[4]) * 1000;

  // Duel may still be Open (waiting for owner's agent to join)
  // Wait until it's Active (state=1) before starting
  let state = Number(duelData[5]);
  if (state === 0) {
    log("   Waiting for agentB to join...");
    while (state === 0 && Date.now() < endTime + 3_600_000) {
      await new Promise(r => setTimeout(r, 10_000));
      const d = await dm.getDuel(duelId);
      state = Number(d[5]);
    }
    if (state !== 1) {
      log("   Duel never became Active — skipping");
      return;
    }
  }

  log(`🤖 Running '${STRATEGY}' strategy`);
  log(`   Duration: ${Math.round((endTime - Date.now()) / 60000)} min`);

  const strategy = makeStrategy(STRATEGY);
  let prices = await fetchPrices();
  strategy.addPriceData(prices);

  while (Date.now() < endTime) {
    prices = await fetchPrices();
    strategy.addPriceData(prices);

    const trades = strategy.computeTrades();
    for (const t of trades) {
      const price = prices[t.asset as keyof PriceData] as number;
      // @ts-ignore
      strategy.executeTrade(t.asset, t.side, t.sizePercent, price);
    }

    const { publicPnlBps } = strategy.calculatePnLBps(prices);

    try {
      const nonce = await provider.getTransactionCount(wallet.address);
      const tx = await marketplace.updateRenterPnL(rentalId, publicPnlBps, { gasLimit: 300_000n, nonce });
      await tx.wait();
      log(`📈 PnL submitted: ${(publicPnlBps / 100).toFixed(2)}%`);
    } catch (e: unknown) {
      log(`⚠️  PnL update failed: ${(e as Error).message?.slice(0, 60)}`);
    }

    const remaining = endTime - Date.now();
    const wait = Math.min(UPDATE_MS, remaining - 1000);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }

  log(`⏱  Duel #${duelId} ended — final PnL: ${(strategy.calculatePnLBps(prices).publicPnlBps / 100).toFixed(2)}%`);
}

async function main() {
  if (!PRIVATE_KEY || !MARKETPLACE_ADDR || !DUEL_MANAGER_ADDR) {
    console.error("Missing env vars. Required:");
    console.error("  RENTER_PRIVATE_KEY, AGENT_MARKETPLACE_ADDRESS, DUEL_MANAGER_ADDRESS");
    process.exit(1);
  }

  const provider    = new ethers.JsonRpcProvider(RPC);
  const wallet      = new ethers.Wallet(PRIVATE_KEY, provider);
  const marketplace = new ethers.Contract(MARKETPLACE_ADDR, MARKETPLACE_ABI, provider);

  log(`🎧 Renter Listener started`);
  log(`   Renter:   ${wallet.address}`);
  log(`   Strategy: ${STRATEGY}`);
  log(`   Watching: ${MARKETPLACE_ADDR}\n`);

  // Listen for new rentals from this renter
  marketplace.on("AgentRented", async (rentalId: bigint, duelId: bigint, renter: string) => {
    if (renter.toLowerCase() !== wallet.address.toLowerCase()) return;
    log(`💰 You rented an agent — rental #${rentalId}`);
    await handleRental(rentalId, duelId, wallet);
  });

  // Catch up on missed active rentals (last 1000 blocks)
  const currentBlock = await provider.getBlockNumber();
  const fromBlock    = Math.max(0, currentBlock - 1000);
  const pastEvents   = await marketplace.queryFilter(marketplace.filters.AgentRented(), fromBlock);

  for (const event of pastEvents) {
    if (!("args" in event)) continue;
    const [rentalId, duelId, renter] = event.args as unknown as [bigint, bigint, string];
    if (renter.toLowerCase() !== wallet.address.toLowerCase()) continue;
    const rental = await marketplace.rentals(rentalId);
    if (!(rental[8] as boolean)) {
      log(`📋 Resuming past rental #${rentalId}`);
      await handleRental(rentalId, duelId, wallet);
    }
  }

  await new Promise(() => {});
}

main().catch(console.error);
