/**
 * sendCommand — send an encrypted private command to your agent.
 *
 * Only you can read it. The message is end-to-end encrypted on-chain via COTI MPC.
 *
 * Usage:
 *   ts-node messaging/sendCommand.ts setStrategy meanReversion
 *   ts-node messaging/sendCommand.ts setRisk 1.5
 *   ts-node messaging/sendCommand.ts focusAsset BTC ETH
 *   ts-node messaging/sendCommand.ts focusAsset            (clears focus — all assets)
 *   ts-node messaging/sendCommand.ts pause
 *   ts-node messaging/sendCommand.ts resume
 *
 * Env vars:
 *   OWNER_PRIVATE_KEY  — your (owner's) private key
 *   OWNER_AES_KEY      — your AES key (run messaging/setup.ts if you don't have one)
 *   AGENT_ADDRESS      — your agent's wallet address (the recipient)
 */
import { createPrivateMessagingClient, sendMessage } from "@coti-io/coti-sdk-private-messaging";
import { Wallet } from "@coti-io/coti-ethers";
import { JsonRpcProvider } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const RPC = "https://testnet.coti.io/rpc";

function buildCommand(args: string[]): object {
  const cmd = args[0];
  if (!cmd) {
    console.error("Usage: sendCommand.ts <cmd> [args...]");
    console.error("  setStrategy <momentum|meanReversion|marketMaker>");
    console.error("  setRisk <0.1–3.0>");
    console.error("  focusAsset [BTC] [ETH] [SOL]");
    console.error("  pause");
    console.error("  resume");
    process.exit(1);
  }

  switch (cmd) {
    case "setStrategy":
      return { cmd: "setStrategy", value: args[1] };
    case "setRisk":
      return { cmd: "setRisk", value: parseFloat(args[1]) };
    case "focusAsset":
      return { cmd: "focusAsset", assets: args.slice(1) };
    case "pause":
      return { cmd: "pause" };
    case "resume":
      return { cmd: "resume" };
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
}

async function main() {
  const ownerKey  = process.env.OWNER_PRIVATE_KEY  ?? process.env.SIGNING_KEYS?.split(",")[0];
  const aesKey    = process.env.OWNER_AES_KEY;
  const agentAddr = process.env.AGENT_ADDRESS;

  if (!ownerKey || !aesKey || !agentAddr) {
    console.error("Set OWNER_PRIVATE_KEY, OWNER_AES_KEY, AGENT_ADDRESS in .env");
    process.exit(1);
  }

  const provider = new JsonRpcProvider(RPC);
  const wallet = new Wallet(ownerKey, provider);
  wallet.setAesKey(aesKey);

  const client = createPrivateMessagingClient({
    network: "testnet",
    runner: wallet,
    aesKey,
  });

  const cmdArgs = process.argv.slice(2);
  const command = buildCommand(cmdArgs);
  const plaintext = JSON.stringify(command);

  console.log(`\n📤 Sending encrypted command to ${agentAddr}:`);
  console.log(`   ${plaintext}`);

  const result = await sendMessage(client, {
    to: agentAddr,
    plaintext,
  });

  console.log(`✅ Sent! tx: ${result.transactionHash}`);
  if (result.messageId !== undefined) {
    console.log(`   messageId: ${result.messageId}`);
  }
  console.log("\nYour agent will receive this command in the next poll cycle.");
  console.log("The message is end-to-end encrypted — only your agent can decrypt it.\n");
}

main().catch(e => { console.error(e.message); process.exit(1); });
