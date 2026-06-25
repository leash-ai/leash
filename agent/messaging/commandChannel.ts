/**
 * CommandChannel — private encrypted command channel for your agent.
 *
 * You send JSON commands from your wallet to your agent's wallet.
 * Nobody else can read them (end-to-end encrypted via COTI garbled circuits).
 *
 * The agent polls its inbox every POLL_MS during an active duel.
 *
 * Commands:
 *   { "cmd": "setStrategy", "value": "momentum" | "meanReversion" | "marketMaker" }
 *   { "cmd": "setRisk",     "value": 0.1–3.0 }   — multiplier on position sizing
 *   { "cmd": "focusAsset",  "assets": ["BTC"]    } — restrict active assets
 *   { "cmd": "pause"   }  — stop submitting PnL updates
 *   { "cmd": "resume"  }  — resume PnL updates
 */
import { createPrivateMessagingClient, listInbox } from "@coti-io/coti-sdk-private-messaging";
import { Wallet } from "@coti-io/coti-ethers";
import { JsonRpcProvider } from "ethers";

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
  private processedCount = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  private onConfigChange?: (config: AgentConfig) => void;

  constructor(privateKey: string, aesKey: string, initialConfig?: Partial<AgentConfig>) {
    const provider = new JsonRpcProvider(RPC);
    this.wallet = new Wallet(privateKey, provider);
    this.wallet.setAesKey(aesKey);

    this.config = {
      strategy:    initialConfig?.strategy    ?? "momentum",
      riskFactor:  initialConfig?.riskFactor  ?? 1.0,
      focusAssets: initialConfig?.focusAssets ?? null,
      paused:      initialConfig?.paused      ?? false,
    };
  }

  getConfig(): AgentConfig { return { ...this.config }; }

  onUpdate(cb: (config: AgentConfig) => void) {
    this.onConfigChange = cb;
  }

  start() {
    if (this.running) return;
    this.running = true;
    log(`📡 Command channel started — polling every ${POLL_MS / 1000}s`);
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
      // Non-fatal — log and continue
      log(`⚠️  Inbox poll error: ${(e as Error).message?.slice(0, 60)}`);
    }

    if (this.running) {
      this.timer = setTimeout(() => this.poll(), POLL_MS);
    }
  }

  private async checkInbox() {
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
      const raw = msg.plaintext?.trim();
      if (!raw) continue;

      try {
        const cmd: AgentCommand = JSON.parse(raw);
        this.applyCommand(cmd);
      } catch {
        log(`⚠️  Unparseable message: ${raw?.slice(0, 40)}`);
      }
    }
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
