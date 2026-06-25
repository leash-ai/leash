/**
 * Deploy using ethers directly (bypasses Hardhat's pending block issue with COTI).
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const provider = new ethers.JsonRpcProvider("https://testnet.coti.io/rpc");
  const wallet = new ethers.Wallet(process.env.SIGNING_KEYS!.split(",")[0], provider);

  const balance = await provider.getBalance(wallet.address);
  console.log("Deployer:", wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "COTI");

  // Load compiled artifact
  const artifactPath = path.join(__dirname, "../artifacts/contracts/DuelManager.sol/DuelManager.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  const feeRecipient = process.env.FEE_RECIPIENT || wallet.address;

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  console.log("\nDeploying DuelManager...");
  const contract = await factory.deploy(feeRecipient, {
    gasLimit: 10_000_000,
  });

  console.log("Tx hash:", contract.deploymentTransaction()?.hash);
  console.log("Waiting for confirmation...");

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("\n✅ DuelManager deployed to:", address);
  console.log("\nUpdate .env:");
  console.log(`DUEL_MANAGER_ADDRESS=${address}`);

  // Auto-update .env
  const envPath = path.join(__dirname, "../.env");
  let envContent = fs.readFileSync(envPath, "utf8");
  envContent = envContent.replace(/DUEL_MANAGER_ADDRESS=.*/, `DUEL_MANAGER_ADDRESS=${address}`);
  fs.writeFileSync(envPath, envContent);
  console.log(".env updated automatically.");
}

main().catch((e) => { console.error(e); process.exit(1); });
