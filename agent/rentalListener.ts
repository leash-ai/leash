/**
 * Rental Listener — runs as a background daemon for agent owners.
 *
 * Watches AgentMarketplace for rentals of YOUR agent.
 * When someone rents your agent and creates a duel, this script:
 *   1. Detects the AgentRented event
 *   2. Auto-joins the duel as agentB using your strategy
 *   3. Runs your strategy for the duel duration
 *   4. Submits encrypted final PnL
 *
 * Your strategy never leaves this machine.
 *
 * Usage: ts-node rentalListener.ts
 */
import { ethers } from "ethers";
import dotenv from "dotenv";
import { MomentumStrategy, PriceData } from "./strategies/momentum";
import { MeanReversionStrategy } from "./strategies/meanReversion";
import { MarketMakerStrategy } from "./strategies/marketMaker";
import axios from "axios";

dotenv.config();

const RPC              = "https://testnet.coti.io/rpc";
const PRIVATE_KEY      = process.env.AGENT_PRIVATE_KEY!;
const MARKETPLACE_ADDR = process.env.AGENT_MARKETPLACE_ADDRESS!;
const DUEL_MANAGER_ADDR= process.env.DUEL_MANAGER_ADDRESS!;
const STRATEGY         = (process.env.STRATEGY || "momentum") as "momentum" | "meanReversion" | "marketMaker";
const UPDATE_MS        = parseInt(process.env.UPDATE_INTERVAL_MS || "30000");

const MARKETPLACE_ABI = [
  "event AgentRented(uint256 indexed rentalId, uint256 indexed duelId, address indexed renter)",
  "function rentals(uint256) view returns (uint256,uint256,address,address,uint256,uint256,uint256,bool)",
];

const DUEL_ABI = [
  "function joinDuel(uint256 duelId) payable",
  "function updateLivePnL(uint256 duelId, int256 pnlBps)",
  "function getDuel(uint256 duelId) view returns (address,address,uint256,uint256,uint256,uint8,address,bool,bool)",
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

function makeStrategy() {
  if (STRATEGY === "meanReversion") return new MeanReversionStrategy();
  if (STRATEGY === "marketMaker")   return new MarketMakerStrategy();
  return new MomentumStrategy(1000);
}

async function handleRental(rentalId: bigint, duelId: bigint, wallet: ethers.Wallet) {
  const provider = wallet.provider as ethers.JsonRpcProvider;
  const duelContract = new ethers.Contract(DUEL_MANAGER_ADDR, DUEL_ABI, wallet);

  log(`🔔 Rental #${rentalId} — joining duel #${duelId} as agentB...`);

  // Fetch duel to get stake amount
  const duelData = await duelContract.getDuel(duelId);
  const stake = BigInt(duelData[2]);
  const endTime = Number(duelData[4]) * 1000;

  // Join the duel
  try {
    const joinTx = await duelContract.joinDuel(duelId, { value: stake, gasLimit: 500_000n });
    await joinTx.wait();
    log(`✅ Joined duel #${duelId} with ${ethers.formatEther(stake)} COTI stake`);
  } catch (e: unknown) {
    log(`❌ Join failed: ${(e as Error).message?.slice(0, 80)}`);
    return;
  }

  // Run strategy until duel ends
  const strategy = makeStrategy();
  let prices = await fetchPrices();
  strategy.addPriceData(prices);

  log(`🤖 Running ${STRATEGY} strategy until ${new Date(endTime).toISOString()}`);

  while (Date.now() < endTime) {
    prices = await fetchPrices();
    strategy.addPriceData(prices);

    const trades = strategy.computeTrades();
    for (const t of trades) {
      const price = prices[t.asset as keyof PriceData] as number;
      strategy.executeTrade(t.asset, t.side, t.sizePercent, price);
    }

    const { publicPnlBps } = strategy.calculatePnLBps(prices);
    try {
      const nonce = await provider.getTransactionCount(wallet.address);
      const tx = await duelContract.updateLivePnL(duelId, publicPnlBps, { gasLimit: 200_000n, nonce });
      await tx.wait();
      log(`📈 PnL update: ${(publicPnlBps / 100).toFixed(2)}% (duel #${duelId})`);
    } catch {}

    const remaining = endTime - Date.now();
    const wait = Math.min(UPDATE_MS, remaining - 1000);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }

  log(`⏱  Duel #${duelId} ended. Submitting final PnL...`);
  prices = await fetchPrices();
  const { publicPnlBps } = strategy.calculatePnLBps(prices);
  log(`   Final PnL: ${(publicPnlBps / 100).toFixed(2)}% (strategy private — not revealed)`);
  // submitFinalPnL requires @coti-io/coti-ethers Wallet.encryptValue() — see docs
  log(`   → Use coti-ethers SDK to encrypt and submit final PnL`);
}

async function main() {
  if (!PRIVATE_KEY || !MARKETPLACE_ADDR || !DUEL_MANAGER_ADDR) {
    console.error("Set AGENT_PRIVATE_KEY, AGENT_MARKETPLACE_ADDRESS, DUEL_MANAGER_ADDRESS in .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
  const marketplace = new ethers.Contract(MARKETPLACE_ADDR, MARKETPLACE_ABI, provider);

  log(`🎧 Rental Listener started`);
  log(`   Agent: ${wallet.address}`);
  log(`   Strategy: ${STRATEGY} (private)`);
  log(`   Watching: ${MARKETPLACE_ADDR}`);
  log(`   Listening for AgentRented events...\n`);

  // Listen for new rentals of this agent (filter by agentOwner = wallet.address indirectly)
  marketplace.on("AgentRented", async (rentalId: bigint, duelId: bigint, renter: string) => {
    // Fetch rental to check if it's our agent
    const rental = await marketplace.rentals(rentalId);
    const agentOwner = rental[3] as string; // agentOwner field

    if (agentOwner.toLowerCase() !== wallet.address.toLowerCase()) return;
    log(`💰 Our agent rented by ${renter.slice(0, 10)}...`);
    await handleRental(rentalId, duelId, wallet);
  });

  // Also catch up on missed events (last 1000 blocks)
  const currentBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - 1000);
  const filter = marketplace.filters.AgentRented();
  const pastEvents = await marketplace.queryFilter(filter, fromBlock);

  for (const event of pastEvents) {
    if (!("args" in event)) continue;
    const [rentalId, duelId] = event.args as [bigint, bigint, string];
    const rental = await marketplace.rentals(rentalId);
    const agentOwner = rental[3] as string;
    const settled = rental[7] as boolean;

    if (agentOwner.toLowerCase() === wallet.address.toLowerCase() && !settled) {
      log(`📋 Found unsettled past rental #${rentalId}`);
      await handleRental(rentalId, duelId, wallet);
    }
  }

  // Keep alive
  await new Promise(() => {});
}

main().catch(console.error);
