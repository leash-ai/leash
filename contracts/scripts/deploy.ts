import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying DuelManager with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "COTI");

  const feeRecipient = process.env.FEE_RECIPIENT || deployer.address;
  console.log("Fee recipient:", feeRecipient);

  const DuelManager = await ethers.getContractFactory("DuelManager");
  const duelManager = await DuelManager.deploy(feeRecipient);
  await duelManager.waitForDeployment();

  const address = await duelManager.getAddress();
  console.log("DuelManager deployed to:", address);
  console.log("\nAdd to .env:");
  console.log(`DUEL_MANAGER_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
