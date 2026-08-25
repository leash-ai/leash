/**
 * CommandChannel — private encrypted command channel for your agent.
 *
 * You send JSON commands from your wallet to your agent's wallet.
 * Nobody else can read them (end-to-end encrypted via COTI garbled circuits).
 *
 * Security:
 *   - Only messages from `ownerAddress` are applied. Others are silently dropped.
 *   - processedCount is persisted to .leash-cursor-<agentAddr>.json between restarts
 *     so old messages are never replayed after a crash.
 *
 * Commands:
 *   { "cmd": "setStrategy", "value": "momentum" | "meanReversion" | "marketMaker" }
 *   { "cmd": "setRisk",     "value": 0.1–3.0 }   — multiplier on position sizing
 *   { "cmd": "focusAsset",  "assets": ["BTC"]    } — restrict active assets
 *   { "cmd": "pause"   }  — stop submitting PnL updates
 *   { "cmd": "resume"  }  — resume PnL updates
 */
import { privateMessagingSdk } from "./sdk";
import { Wallet } from "@coti-io/coti-ethers";
import { JsonRpcProvider } from "ethers";
import * as fs from "fs";
import * as path from "path";

export type StrategyName = "momentum" | "meanReversion" | "marketMaker";

export interface AgentConfig {
  strategy:    StrategyName;
  riskFactor:  number;           // position size multiplier (default 1.0)
  focusAssets: string[] | null;  // null = all assets
  paused:      boolean;
}

export interface AgentCommand {
  cmd:      string;
  value?:   string | number;
  assets?:  string[];
}

const POLL_MS = 15_000;
const RPC     = "https://testnet.coti.io/rpc";

function log(msg: string) {
  console.log(`[MSG ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

export class CommandChannel {
  private config: AgentConfig;
  private wallet: Wallet;
  private ownerAddress: string;
  private processedCount = 0;
  private cursorFile: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  private onConfigChange?: (config: AgentConfig) => void;

  constructor(
    privateKey: string,
    aesKey: string,
    ownerAddress: string,
    initialConfig?: Partial<AgentConfig>
  ) {
    const provider = new JsonRpcProvider(RPC);
    this.wallet = new Wallet(privateKey, provider);
    this.wallet.setAesKey(aesKey);
    this.ownerAddress = ownerAddress.toLowerCase();

    this.config = {
      strategy:    initialConfig?.strategy    ?? "momentum",
      riskFactor:  initialConfig?.riskFactor  ?? 1.0,
      focusAssets: initialConfig?.focusAssets ?? null,
      paused:      initialConfig?.paused      ?? false,
    };

    // Cursor file persists processedCount across restarts
    const agentAddr = new Wallet(privateKey).address.toLowerCase().slice(2, 10);
    this.cursorFile = path.join(process.cwd(), `.leash-cursor-${agentAddr}.json`);
    this.loadCursor();
  }

  private loadCursor() {
    try {
      if (fs.existsSync(this.cursorFile)) {
        const data = JSON.parse(fs.readFileSync(this.cursorFile, "utf8"));
        if (typeof data.processedCount === "number") {
          this.processedCount = data.processedCount;
          log(`📁 Cursor restored: ${this.processedCount} messages already processed`);
        }
      }
    } catch {
      // Corrupt file — start from 0 (messages since daemon started)
    }
  }

  private saveCursor() {
    try {
      fs.writeFileSync(this.cursorFile, JSON.stringify({ processedCount: this.processedCount }));
    } catch {
      // Non-fatal
    }
  }

  getConfig(): AgentConfig { return { ...this.config }; }

  onUpdate(cb: (config: AgentConfig) => void) {
    this.onConfigChange = cb;
  }

  start() {
    if (this.running) return;
    this.running = true;
    log(`📡 Command channel started — polling every ${POLL_MS / 1000}s`);
    log(`   Accepting commands from: ${this.ownerAddress}`);
    this.poll();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    log("📡 Command channel stopped");
  }

  private async poll() {
    try {
      await this.checkInbox();
    } catch (e) {
      log(`⚠️  Inbox poll error: ${(e as Error).message?.slice(0, 60)}`);
    }

    if (this.running) {
      this.timer = setTimeout(() => this.poll(), POLL_MS);
    }
  }

  private async checkInbox() {
    const { createPrivateMessagingClient, listInbox } = await privateMessagingSdk();

    const client = createPrivateMessagingClient({
      network: "testnet",
      runner: this.wallet,
      aesKey: (this.wallet as any)._userOnboardInfo?.aesKey ??
               (this.wallet as any).getUserOnboardInfo()?.aesKey ?? undefined,
    });

    const myAddress = await this.wallet.getAddress();

    const result = await listInbox(client, {
      account: myAddress,
      offset:  this.processedCount,
      limit:   20,
      decrypt: true,
    });

    if (!result.messages || result.messages.length === 0) return;

    for (const msg of result.messages) {
      this.processedCount++;

      // Security: only apply commands from the authorised owner
      if ((msg as any).from?.toLowerCase() !== this.ownerAddress) {
        log(`🚫 Dropped message from unknown sender: ${(msg as any).from?.slice(0, 10)}`);
        continue;
      }

      const raw = (msg as any).plaintext?.trim();
      if (!raw) continue;

      try {
        const cmd: AgentCommand = JSON.parse(raw);
        this.applyCommand(cmd);
      } catch {
        log(`⚠️  Unparseable message: ${raw?.slice(0, 40)}`);
      }
    }

    // Persist cursor after every batch so restarts don't replay old messages
    this.saveCursor();
  }

  private applyCommand(cmd: AgentCommand) {
    const prev = { ...this.config };

    switch (cmd.cmd) {
      case "setStrategy": {
        const valid: StrategyName[] = ["momentum", "meanReversion", "marketMaker"];
        if (typeof cmd.value === "string" && valid.includes(cmd.value as StrategyName)) {
          this.config.strategy = cmd.value as StrategyName;
          log(`🔄 Strategy → ${this.config.strategy}`);
        } else {
          log(`⚠️  Unknown strategy: ${cmd.value}`);
        }
        break;
      }
      case "setRisk": {
        const v = Number(cmd.value);
        if (!isNaN(v) && v >= 0.1 && v <= 3.0) {
          this.config.riskFactor = v;
          log(`⚖️  Risk factor → ${v.toFixed(2)}`);
        } else {
          log(`⚠️  Invalid risk value: ${cmd.value} (must be 0.1–3.0)`);
        }
        break;
      }
      case "focusAsset": {
        if (Array.isArray(cmd.assets) && cmd.assets.length > 0) {
          this.config.focusAssets = cmd.assets.map(a => a.toUpperCase());
          log(`🎯 Focused on: ${this.config.focusAssets.join(", ")}`);
        } else {
          this.config.focusAssets = null;
          log("🎯 Focus cleared — all assets active");
        }
        break;
      }
      case "pause": {
        this.config.paused = true;
        log("⏸  Agent paused — PnL updates suspended");
        break;
      }
      case "resume": {
        this.config.paused = false;
        log("▶️  Agent resumed");
        break;
      }
      default:
        log(`⚠️  Unknown command: ${cmd.cmd}`);
    }

    const changed =
      prev.strategy    !== this.config.strategy    ||
      prev.riskFactor  !== this.config.riskFactor  ||
      prev.paused      !== this.config.paused       ||
      JSON.stringify(prev.focusAssets) !== JSON.stringify(this.config.focusAssets);

    if (changed && this.onConfigChange) {
      this.onConfigChange({ ...this.config });
    }
  }
}
