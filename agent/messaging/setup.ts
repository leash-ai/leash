/**
 * setup — generate or recover your COTI AES key.
 *
 * The AES key is required to encrypt/decrypt private messages.
 * It is derived deterministically from your private key via the COTI
 * AccountOnboard contract. Running this twice gives the same key.
 *
 * The key is stored in your .env as AES_KEY (for your wallet)
 * and OWNER_AES_KEY (for the owner sending commands).
 *
 * Usage:
 *   ts-node messaging/setup.ts
 *   ts-node messaging/setup.ts agent   (generates for AGENT_PRIVATE_KEY)
 *   ts-node messaging/setup.ts owner   (generates for SIGNING_KEYS[0])
 */
import { Wallet } from "@coti-io/coti-ethers";
import { JsonRpcProvider } from "ethers";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

const RPC              = "https://testnet.coti.io/rpc";
const ONBOARD_CONTRACT = "0x536A67f0cc46513E7d27a370ed1aF9FDcC7A5095";

async function deriveAesKey(privateKey: string): Promise<string> {
  const provider = new JsonRpcProvider(RPC);
  const wallet = new Wallet(privateKey, provider);

  console.log(`\nDeriving AES key for ${wallet.address}...`);
  await wallet.generateOrRecoverAes(ONBOARD_CONTRACT);

  const info = wallet.getUserOnboardInfo();
  if (!info?.aesKey) throw new Error("Failed to derive AES key");

  return info.aesKey;
}

function updateEnv(key: string, value: string) {
  const envPath = path.join(__dirname, "../../.env");
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

  if (content.includes(`${key}=`)) {
    content = content.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }

  fs.writeFileSync(envPath, content);
  console.log(`✅ Saved to .env: ${key}=***`);
}

async function main() {
  const mode = process.argv[2] ?? "both";

  if (mode === "agent" || mode === "both") {
    const agentKey = process.env.AGENT_PRIVATE_KEY;
    if (!agentKey) {
      console.log("⚠️  AGENT_PRIVATE_KEY not set — skipping agent key generation");
    } else {
      const aesKey = await deriveAesKey(agentKey);
      updateEnv("AES_KEY", aesKey);
      console.log(`   AES Key: ${aesKey}`);
    }
  }

  if (mode === "owner" || mode === "both") {
    const ownerKey = process.env.SIGNING_KEYS?.split(",")[0];
    if (!ownerKey) {
      console.log("⚠️  SIGNING_KEYS not set — skipping owner key generation");
    } else {
      const aesKey = await deriveAesKey(ownerKey);
      updateEnv("OWNER_AES_KEY", aesKey);
      console.log(`   AES Key: ${aesKey}`);
    }
  }

  console.log("\n🎉 AES key setup complete.");
  console.log("   Run ts-node messaging/sendCommand.ts to send commands to your agent.\n");
}

main().catch(e => { console.error(e.message); process.exit(1); });
