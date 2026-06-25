/**
 * Rental Listener — background daemon for agent owners.
 *
 * Watches AgentMarketplace for rentals of YOUR agent.
 * When someone rents your agent and creates a duel:
 *   1. Auto-joins the duel as agentB
 *   2. Runs your chosen strategy (private — never on-chain)
 *   3. Listens for encrypted commands from your wallet via COTI private messaging
 *   4. Applies command changes (strategy/risk/focus/pause) in real-time
 *
 * Your strategy and any steering commands stay end-to-end encrypted.
 *
 * Usage: ts-node rentalListener.ts
 *
 * Required env vars:
 *   AGENT_PRIVATE_KEY     — agent wallet key (agentB in duels)
 *   AES_KEY               — COTI AES key for the agent wallet (run messaging/setup.ts)
 *   AGENT_MARKETPLACE_ADDRESS
 *   DUEL_MANAGER_ADDRESS
 *
 * Optional:
 *   STRATEGY              — default strategy (momentum | meanReversion | marketMaker)
 *   UPDATE_INTERVAL_MS    — how often to post PnL (default 30s)
 */
import { ethers } from "ethers";
import dotenv from "dotenv";
import axios from "axios";
import { MomentumStrategy, PriceData } from "./strategies/momentum";
import { MeanReversionStrategy } from "./strategies/meanReversion";
import { MarketMakerStrategy } from "./strategies/marketMaker";
import { CommandChannel, AgentConfig, StrategyName } from "./messaging/commandChannel";

dotenv.config();

const RPC              = "https://testnet.coti.io/rpc";
const PRIVATE_KEY      = process.env.AGENT_PRIVATE_KEY!;
const AES_KEY          = process.env.AES_KEY!;
const MARKETPLACE_ADDR = process.env.AGENT_MARKETPLACE_ADDRESS!;
const DUEL_MANAGER_ADDR= process.env.DUEL_MANAGER_ADDRESS!;
const DEFAULT_STRATEGY = (process.env.STRATEGY || "momentum") as StrategyName;
const UPDATE_MS        = parseInt(process.env.UPDATE_INTERVAL_MS || "30000");

const MARKETPLACE_ABI = [
  "event AgentRented(uint256 indexed rentalId, uint256 indexed duelId, address indexed renter)",
  "function rentals(uint256) view returns (uint256,uint256,uint256,address,address,uint256,uint256,uint256,bool)",
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

function makeStrategy(name: StrategyName) {
  if (name === "meanReversion") return new MeanReversionStrategy();
  if (name === "marketMaker")   return new MarketMakerStrategy();
  return new MomentumStrategy(1000);
}

async function handleRental(rentalId: bigint, duelId: bigint, wallet: ethers.Wallet, channel: CommandChannel) {
  const provider = wallet.provider as ethers.JsonRpcProvider;
  const duelContract = new ethers.Contract(DUEL_MANAGER_ADDR, DUEL_ABI, wallet);

  log(`🔔 Rental #${rentalId} — joining duel #${duelId}...`);

  const duelData = await duelContract.getDuel(duelId);
  const stake = BigInt(duelData[2]);
  const endTime = Number(duelData[4]) * 1000;

  try {
    const joinTx = await duelContract.joinDuel(duelId, { value: stake, gasLimit: 500_000n });
    await joinTx.wait();
    log(`✅ Joined duel #${duelId} with ${ethers.formatEther(stake)} COTI`);
  } catch (e: unknown) {
    log(`❌ Join failed: ${(e as Error).message?.slice(0, 80)}`);
    return;
  }

  // Init strategy from current config
  let config = channel.getConfig();
  let strategy = makeStrategy(config.strategy);

  // When owner sends a setStrategy command, rebuild strategy object
  channel.onUpdate((newConfig: AgentConfig) => {
    if (newConfig.strategy !== config.strategy) {
      log(`🔄 Rebuilding strategy: ${config.strategy} → ${newConfig.strategy}`);
      strategy = makeStrategy(newConfig.strategy);
    }
    config = newConfig;
  });

  log(`🤖 Running '${config.strategy}' strategy — listening for commands`);
  log(`   Duration: ${Math.round((endTime - Date.now()) / 60000)} min`);
  log(`   Send commands: ts-node messaging/sendCommand.ts <cmd> [args]`);

  let prices = await fetchPrices();
  strategy.addPriceData(prices);

  while (Date.now() < endTime) {
    prices = await fetchPrices();
    config = channel.getConfig(); // always get latest config

    strategy.addPriceData(prices);

    const trades = strategy.computeTrades();
    for (const t of trades) {
      // Apply focusAssets filter
      if (config.focusAssets && !config.focusAssets.includes(t.asset)) continue;
      const price = prices[t.asset as keyof PriceData] as number;
      // @ts-ignore — side type varies by strategy (long/short vs buy/sell)
      strategy.executeTrade(t.asset, t.side, t.sizePercent * config.riskFactor, price);
    }

    if (!config.paused) {
      const { publicPnlBps } = strategy.calculatePnLBps(prices);

      try {
        const nonce = await provider.getTransactionCount(wallet.address);
        const tx = await duelContract.updateLivePnL(duelId, publicPnlBps, { gasLimit: 200_000n, nonce });
        await tx.wait();
        const pnlPct = (publicPnlBps / 100).toFixed(2);
        const risk = config.riskFactor !== 1.0 ? ` [risk×${config.riskFactor.toFixed(1)}]` : "";
        const focus = config.focusAssets ? ` [${config.focusAssets.join("+")}]` : "";
        log(`📈 ${pnlPct}%${risk}${focus}`);
      } catch {}
    } else {
      log("⏸  Paused — skipping PnL update");
    }

    const remaining = endTime - Date.now();
    const wait = Math.min(UPDATE_MS, remaining - 1000);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }

  log(`⏱  Duel #${duelId} ended`);
  const finalConfig = channel.getConfig();
  const { publicPnlBps } = strategy.calculatePnLBps(await fetchPrices());
  log(`   Final PnL: ${(publicPnlBps / 100).toFixed(2)}% | strategy: ${finalConfig.strategy}`);
}

async function main() {
  if (!PRIVATE_KEY || !AES_KEY || !MARKETPLACE_ADDR || !DUEL_MANAGER_ADDR) {
    console.error("Missing env vars. Required:");
    console.error("  AGENT_PRIVATE_KEY, AES_KEY, AGENT_MARKETPLACE_ADDRESS, DUEL_MANAGER_ADDRESS");
    console.error("Run: ts-node messaging/setup.ts agent  (to generate AES_KEY)");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
  const marketplace = new ethers.Contract(MARKETPLACE_ADDR, MARKETPLACE_ABI, provider);

  // Start the private command channel
  const channel = new CommandChannel(PRIVATE_KEY, AES_KEY, { strategy: DEFAULT_STRATEGY });
  channel.start();

  log(`🎧 Rental Listener started`);
  log(`   Agent:    ${wallet.address}`);
  log(`   Strategy: ${DEFAULT_STRATEGY} (private)`);
  log(`   Commands: ts-node messaging/sendCommand.ts setStrategy momentum`);
  log(`   Watching: ${MARKETPLACE_ADDR}\n`);

  marketplace.on("AgentRented", async (rentalId: bigint, duelId: bigint, renter: string) => {
    const rental = await marketplace.rentals(rentalId);
    const agentOwner = rental[4] as string;
    if (agentOwner.toLowerCase() !== wallet.address.toLowerCase()) return;
    log(`💰 Rented by ${renter.slice(0, 10)}...`);
    await handleRental(rentalId, duelId, wallet, channel);
  });

  // Catch up on missed rentals
  const currentBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - 1000);
  const pastEvents = await marketplace.queryFilter(marketplace.filters.AgentRented(), fromBlock);

  for (const event of pastEvents) {
    if (!("args" in event)) continue;
    const [rentalId, duelId] = event.args as unknown as [bigint, bigint, string];
    const rental = await marketplace.rentals(rentalId);
    if (
      (rental[4] as string).toLowerCase() === wallet.address.toLowerCase() &&
      !(rental[8] as boolean)
    ) {
      log(`📋 Resuming past rental #${rentalId}`);
      await handleRental(rentalId, duelId, wallet, channel);
    }
  }

  await new Promise(() => {});
}

main().catch(console.error);
