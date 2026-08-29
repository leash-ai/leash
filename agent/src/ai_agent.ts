import { ChatMessage, LlmClient, makeLlmClient } from "./llm";
import {
  Portfolio,
  createPortfolio,
  applyAction,
  getPnLBps,
  getCurrentValue,
  portfolioSummary,
} from "./portfolio";
import { Prices } from "./prices";

export interface AgentDecision {
  action: { type: "BUY" | "SELL" | "HOLD"; symbol?: string; pct?: number };
  reasoning: string;
  tradeLog: string;
  pnlBps: number;
}

export interface AgentState {
  strategy: string;
  portfolio: Portfolio;
  chatHistory: Array<{ role: "user" | "assistant"; content: string }>;
  pendingMessages: string[];
  duelId?: number;
}

export function createAgentState(): AgentState {
  return {
    strategy: "No strategy set — wait for owner instructions.",
    portfolio: createPortfolio(),
    chatHistory: [],
    pendingMessages: [],
  };
}

const SYSTEM_PROMPT = `You are a competitive AI crypto trading agent in a short duel (1–5 minutes).
You manage a virtual portfolio starting at $10,000 USDT.
Goal: maximize % gain vs your opponent before time runs out.

Available: BTC, ETH, SOL, BNB, AVAX.

MODE A — STRATEGY CHAT (when owner sends instructions):
Respond naturally. Confirm the strategy you will execute.

MODE B — TRADING TICK (when you receive "TRADING TICK"):
Respond with ONLY this JSON (no extra text):
{"action":"BUY","symbol":"ETH","pct":40,"reasoning":"ETH momentum strong"}
- action: BUY | SELL | HOLD
- pct: % of cash (BUY) or % of position (SELL)
- Keep reasoning under 10 words.`;

export class TradingAgent {
  private llm: LlmClient | null = null;

  /**
   * Built on first use, not in the constructor. The HTTP server creates this
   * agent at start-up, and a missing key should surface as a message in the
   * duel feed rather than stopping the server from booting.
   */
  private client(): LlmClient {
    if (!this.llm) this.llm = makeLlmClient();
    return this.llm;
  }

  /**
   * Turn a conversation into a bot: a name and a brief the trading agent can act
   * on without the conversation.
   *
   * Returns whatever the model said even when the JSON is malformed — a reply
   * the user can read beats an error, and `ready:false` simply means the UI keeps
   * the conversation going rather than offering to save.
   */
  async design(
    systemPrompt: string,
    history: { role: string; content: string }[],
  ): Promise<{ reply: string; ready: boolean; name?: string; strategy?: string }> {
    // 0.7 rather than the 0.4 the trading loop uses. A trade decision wants the
    // same answer to the same inputs; naming a bot does not, and at 0.4 every
    // conversation converged on the same handful of names.
    const raw = await this.client().complete(
      [{ role: "system", content: systemPrompt }, ...(history as ChatMessage[])],
      500,
      0.7,
    );

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { reply: raw.trim() || "…", ready: false };

    try {
      const p = JSON.parse(match[0]);
      const ready = p.ready === true && !!p.name && !!p.strategy;
      return {
        reply: String(p.reply ?? "").trim() || "…",
        ready,
        name: ready ? String(p.name).slice(0, 40) : undefined,
        strategy: ready ? String(p.strategy).slice(0, 600) : undefined,
      };
    } catch {
      return { reply: raw.trim().slice(0, 400), ready: false };
    }
  }

  async chat(state: AgentState, userMessage: string): Promise<string> {
    state.chatHistory.push({ role: "user", content: userMessage });

    const messages: any[] = [
      {
        role: "system",
        content: SYSTEM_PROMPT + `\n\nCurrent strategy: ${state.strategy}`,
      },
      ...state.chatHistory.slice(-10),
    ];

    const reply = (await this.client().complete(messages, 300)) || "...";
    state.chatHistory.push({ role: "assistant", content: reply });

    // Update strategy from meaningful user messages
    if (userMessage.length > 15 && !reply.startsWith("{")) {
      state.strategy = userMessage.slice(0, 200);
    }

    return reply;
  }

  async tick(state: AgentState, prices: Prices): Promise<AgentDecision> {
    const currentValue = getCurrentValue(state.portfolio, prices);
    const pnlBps = getPnLBps(state.portfolio, prices);

    const priceDesc = Object.entries(prices)
      .map(([sym, p]) => `${sym}:$${p.toFixed(0)}`)
      .join(" ");

    const pending = state.pendingMessages.shift();
    const ownerNote = pending ? `\nOwner says: "${pending}"` : "";

    const tickPrompt = `TRADING TICK — JSON only.
Strategy: ${state.strategy}
Portfolio: ${portfolioSummary(state.portfolio, prices)}
Prices: ${priceDesc}${ownerNote}`;

    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: tickPrompt },
    ];

    try {
      const raw: string = (await this.client().complete(messages, 120, 0.3)) || '{"action":"HOLD"}';
      const jsonMatch = raw.match(/\{[^{}]*\}/);
      const parsed = JSON.parse(jsonMatch?.[0] ?? '{"action":"HOLD"}');
      // Models answer with "action"; applyAction expects "type".
      const normalizedAction = {
        type: (parsed.type ?? parsed.action ?? "HOLD") as "BUY" | "SELL" | "HOLD",
        symbol: parsed.symbol,
        pct: parsed.pct,
      };
      const tradeLog = applyAction(state.portfolio, normalizedAction, prices);
      const newPnl = getPnLBps(state.portfolio, prices);

      return {
        action: normalizedAction,
        reasoning: parsed.reasoning ?? "",
        tradeLog,
        pnlBps: newPnl,
      };
    } catch (e) {
      // Holding is the right fallback — a duel should not be decided by a model
      // outage — but "parse error" was the wrong explanation for every cause.
      // The usual one is an unfunded key, and reading that as a JSON problem
      // sends you looking in the wrong place entirely.
      const raw = String((e as Error)?.message ?? "");
      const keyVar = process.env.AI_BASE_URL ? "AI_API_KEY" : "MISTRAL_API_KEY";
      const reasoning =
        raw.includes("No LLM configured")
          ? "holding — no LLM configured (see AI_BASE_URL / MISTRAL_API_KEY)"
          : raw.includes("402") || /subscription|quota|credit|insufficient/i.test(raw)
            ? `holding — ${keyVar} has no credit`
            : /401|403|unauthor|invalid.*key/i.test(raw)
              ? `holding — ${keyVar} rejected`
              : /429|rate.?limit/i.test(raw)
                ? "holding — provider rate limit, will retry next tick"
                : /timeout|ETIMEDOUT|ENOTFOUND|fetch failed|aborted/i.test(raw)
                  ? "holding — model unreachable"
                  : `holding — ${raw.slice(0, 60) || "unparseable model response"}`;

      return {
        action: { type: "HOLD" },
        reasoning,
        tradeLog: "HOLD",
        pnlBps,
      };
    }
  }
}
