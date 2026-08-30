/**
 * redeploy-duels.ts — new DuelManager, keeping the agents and their history.
 *
 * AgentMarketplace holds `duelManager` as immutable, so a new DuelManager needs
 * a new Marketplace with it. AgentRegistry and PrivateTestUSDC do not depend on
 * either, and the Registry's owner can authorise the new Marketplace — so agent
 * registrations and their fight records survive. Duel history does not: duels
 * live in the DuelManager, and a new one starts empty.
 *
 *   npx ts-node scripts/redeploy-duels.ts
 *
 * Writes the new addresses back into contracts/.env. The agent and frontend env
 * files have to be updated too — they are separate packages with their own .env.
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
dotenv.config();

const RPC = process.env.COTI_RPC || "https://testnet.coti.io/rpc";
const GAS = { gasLimit: 8_000_000n };

const artifact = (name: string) =>
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`),
      "utf8",
    ),
  );

async function deploy(wallet: ethers.Wallet, name: string, args: unknown[]) {
  const a = artifact(name);
  const factory = new ethers.ContractFactory(a.abi, a.bytecode, wallet);
  process.stdout.write(`  deploying ${name}… `);
  const contract = await factory.deploy(...args, GAS);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(address);
  return { contract, address, abi: a.abi };
}

function updateEnv(updates: Record<string, string>) {
  const envPath = path.join(__dirname, "../.env");
  let content = fs.readFileSync(envPath, "utf8");
  for (const [key, val] of Object.entries(updates)) {
    content = content.match(new RegExp(`^${key}=`, "m"))
      ? content.replace(new RegExp(`^${key}=.*`, "m"), `${key}=${val}`)
      : content + `\n${key}=${val}`;
  }
  fs.writeFileSync(envPath, content);
}

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const owner = new ethers.Wallet(process.env.SIGNING_KEYS!.split(",")[0], provider);

  const registry = process.env.AGENT_REGISTRY_ADDRESS!;
  const usdc = process.env.CUSDC_ADDRESS!;
  const feeRecipient = process.env.FEE_RECIPIENT || owner.address;

  console.log(`\n  owner    ${owner.address}`);
  console.log(`  balance  ${ethers.formatEther(await provider.getBalance(owner.address)).slice(0, 8)} COTI`);
  console.log(`  keeping  registry ${registry}`);
  console.log(`           usdc     ${usdc}\n`);

  const { address: dmAddr } = await deploy(owner, "TestDuelManager", [feeRecipient]);
  const { address: mktAddr } = await deploy(owner, "AgentMarketplace", [
    usdc,
    registry,
    dmAddr,
    feeRecipient,
  ]);

  // Without this the new Marketplace cannot record fights and settleRental
  // reverts at the end of every rental.
  const reg = new ethers.Contract(registry, artifact("AgentRegistry").abi, owner);
  process.stdout.write("  authorising the marketplace on the registry… ");
  await (await reg.setAuthorised(mktAddr, true, GAS)).wait();
  console.log("done");

  updateEnv({ DUEL_MANAGER_ADDRESS: dmAddr, AGENT_MARKETPLACE_ADDRESS: mktAddr });

  console.log(`\n  DUEL_MANAGER_ADDRESS=${dmAddr}`);
  console.log(`  AGENT_MARKETPLACE_ADDRESS=${mktAddr}`);
  console.log(`\n  Update agent/.env and frontend/.env.local with the same values.\n`);
})();
