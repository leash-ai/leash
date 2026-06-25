/**
 * deploy-all.ts — deploy the full Leash stack to COTI testnet.
 *
 * Deploys:
 *   1. PrivateTestUSDC (mock USDC for testnet)
 *   2. AgentRegistry (MPC-encrypted NFT ownership)
 *   3. TestDuelManager (relaxed duration — 1s min for testnet demos)
 *   4. AgentMarketplace
 *   5. Authorisations + initial ptUSDC mint
 *
 * Usage: npx ts-node scripts/deploy-all.ts
 * Env:   SIGNING_KEYS, FEE_RECIPIENT (optional)
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

const RPC = "https://testnet.coti.io/rpc";
const GAS = { gasLimit: 10_000_000n };

function artifact(name: string) {
  const p = path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function deploy(wallet: ethers.Wallet, name: string, args: unknown[]) {
  const a = artifact(name);
  const factory = new ethers.ContractFactory(a.abi, a.bytecode, wallet);
  process.stdout.write(`Deploying ${name}...`);
  const contract = await factory.deploy(...args, GAS);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(` ✅ ${address}`);
  return { contract, address, abi: a.abi };
}

function updateEnv(updates: Record<string, string>) {
  const envPath = path.join(__dirname, "../.env");
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  for (const [key, val] of Object.entries(updates)) {
    if (content.match(new RegExp(`^${key}=`, "m"))) {
      content = content.replace(new RegExp(`^${key}=.*`, "m"), `${key}=${val}`);
    } else {
      content += `\n${key}=${val}`;
    }
  }
  fs.writeFileSync(envPath, content);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet   = new ethers.Wallet(process.env.SIGNING_KEYS!.split(",")[0], provider);
  const feeRecipient = process.env.FEE_RECIPIENT || wallet.address;

  const balance = ethers.formatEther(await provider.getBalance(wallet.address));
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Leash — Full Stack Deployment (COTI Testnet)");
  console.log(`  Deployer:      ${wallet.address}`);
  console.log(`  Balance:       ${balance} COTI`);
  console.log(`  Fee recipient: ${feeRecipient}`);
  console.log("══════════════════════════════════════════════════════\n");

  // 1. Mock USDC
  const { address: cUSDCAddr } = await deploy(wallet, "PrivateTestUSDC", []);

  // 2. AgentRegistry
  const { contract: regContract, address: regAddr } = await deploy(wallet, "AgentRegistry", []);

  // 3. TestDuelManager (1s min duration — testnet/demo friendly)
  const { address: dmAddr } = await deploy(wallet, "TestDuelManager", [feeRecipient]);

  // 4. AgentMarketplace
  const { address: mktAddr } = await deploy(wallet, "AgentMarketplace", [
    cUSDCAddr, regAddr, dmAddr, feeRecipient,
  ]);

  // 5. Authorise marketplace on registry
  process.stdout.write("Authorising marketplace on AgentRegistry...");
  const reg = new ethers.Contract(regAddr, artifact("AgentRegistry").abi, wallet);
  await (await reg.setAuthorised(mktAddr, true, GAS)).wait();
  console.log(" ✅");

  // 6. Mint ptUSDC to deployer (convenience)
  process.stdout.write("Minting 100,000 ptUSDC to deployer...");
  const usdc = new ethers.Contract(cUSDCAddr, artifact("PrivateTestUSDC").abi, wallet);
  await (await usdc["mint(address,uint256)"](wallet.address, 100_000_000_000n, GAS)).wait();
  console.log(" ✅");

  // Persist to .env
  updateEnv({
    CUSDC_ADDRESS:             cUSDCAddr,
    AGENT_REGISTRY_ADDRESS:    regAddr,
    DUEL_MANAGER_ADDRESS:      dmAddr,
    AGENT_MARKETPLACE_ADDRESS: mktAddr,
  });

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Deployment complete — addresses saved to .env");
  console.log(`  PrivateTestUSDC:  ${cUSDCAddr}`);
  console.log(`  AgentRegistry:    ${regAddr}`);
  console.log(`  TestDuelManager:  ${dmAddr}`);
  console.log(`  AgentMarketplace: ${mktAddr}`);
  console.log("══════════════════════════════════════════════════════\n");
}

main().catch(e => { console.error(e.message); process.exit(1); });
