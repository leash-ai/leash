/**
 * Deploy the full Leash marketplace stack:
 *   1. PrivateTestUSDC (testnet) or point to p.USDC.e (mainnet: 0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C)
 *   2. AgentRegistry (agent NFT + stats)
 *   3. AgentMarketplace (rental + cUSDC payment)
 *   4. Authorise marketplace on registry
 *   5. Authorise marketplace on duel manager
 *
 * Usage: npx ts-node scripts/deploy-marketplace.ts
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

const RPC = "https://testnet.coti.io/rpc";
const GAS = { gasLimit: 10_000_000n };
const IS_TESTNET = true; // flip to false for mainnet

const MAINNET_PUSDC = "0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C";

async function deploy(wallet: ethers.Wallet, name: string, args: unknown[]) {
  const artifactPath = path.join(
    __dirname,
    `../artifacts/contracts/${name}.sol/${name}.json`
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log(`\nDeploying ${name}...`);
  const contract = await factory.deploy(...args, GAS);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`✅ ${name} → ${address}`);
  return { contract, address, abi: artifact.abi };
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.SIGNING_KEYS!.split(",")[0], provider);
  const duelManagerAddress = process.env.DUEL_MANAGER_ADDRESS!;

  console.log("\n══════════════════════════════════════════");
  console.log("  Leash Marketplace Deployment");
  console.log(`  Deployer: ${wallet.address}`);
  console.log(`  Balance: ${ethers.formatEther(await provider.getBalance(wallet.address))} COTI`);
  console.log(`  DuelManager: ${duelManagerAddress}`);
  console.log("══════════════════════════════════════════");

  // 1. cUSDC (testnet: deploy mock; mainnet: use existing)
  let cUSDCAddress: string;
  if (IS_TESTNET) {
    const { address } = await deploy(wallet, "PrivateTestUSDC", []);
    cUSDCAddress = address;
  } else {
    cUSDCAddress = MAINNET_PUSDC;
    console.log(`\nUsing mainnet p.USDC.e: ${cUSDCAddress}`);
  }

  // 2. AgentRegistry
  const { contract: registryContract, address: registryAddress } =
    await deploy(wallet, "AgentRegistry", []);

  // 3. AgentMarketplace
  const { address: marketplaceAddress } = await deploy(wallet, "AgentMarketplace", [
    cUSDCAddress,
    registryAddress,
    duelManagerAddress,
    wallet.address, // fee recipient
  ]);

  // 4. Authorise marketplace on registry
  console.log("\nAuthorising marketplace on AgentRegistry...");
  const registryAbi = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../artifacts/contracts/AgentRegistry.sol/AgentRegistry.json"),
      "utf8"
    )
  ).abi;
  const registry = new ethers.Contract(registryAddress, registryAbi, wallet);
  const authTx = await registry.setAuthorised(marketplaceAddress, true, GAS);
  await authTx.wait();
  console.log("✅ Marketplace authorised on registry");

  // 5. Mint test cUSDC for deployer (testnet only)
  if (IS_TESTNET) {
    console.log("\nMinting 10,000 tUSDC for deployer...");
    const mockAbi = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../artifacts/contracts/PrivateTestUSDC.sol/PrivateTestUSDC.json"),
        "utf8"
      )
    ).abi;
    const mockUSDC = new ethers.Contract(cUSDCAddress, mockAbi, wallet);
    const mintTx = await mockUSDC["mint(address,uint256)"](wallet.address, 10_000_000_000n, GAS); // 10,000 ptUSDC (6 dec)
    await mintTx.wait();
    console.log("✅ 10,000 tUSDC minted");
  }

  // Write addresses to .env
  const envPath = path.join(__dirname, "../.env");
  let envContent = fs.readFileSync(envPath, "utf8");
  const updates: Record<string, string> = {
    CUSDC_ADDRESS: cUSDCAddress,
    AGENT_REGISTRY_ADDRESS: registryAddress,
    AGENT_MARKETPLACE_ADDRESS: marketplaceAddress,
  };
  for (const [key, val] of Object.entries(updates)) {
    if (envContent.includes(`${key}=`)) {
      envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${val}`);
    } else {
      envContent += `\n${key}=${val}`;
    }
  }
  fs.writeFileSync(envPath, envContent);

  console.log("\n══════════════════════════════════════════");
  console.log("  Deployment complete!");
  console.log(`  cUSDC:            ${cUSDCAddress}`);
  console.log(`  AgentRegistry:    ${registryAddress}`);
  console.log(`  AgentMarketplace: ${marketplaceAddress}`);
  console.log("══════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
