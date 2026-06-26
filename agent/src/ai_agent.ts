import { Mistral } from "@mistralai/mistralai";
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

export class MistralAgent {
  private client: Mistral;

  constructor() {
    this.client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY! });
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

    const res = await this.client.chat.complete({
      model: "mistral-small-latest",
      messages,
      maxTokens: 300,
    });

    const reply = (res.choices?.[0]?.message?.content as string) ?? "...";
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
      const res = await this.client.chat.complete({
        model: "mistral-small-latest",
        messages,
        maxTokens: 120,
        temperature: 0.3,
      });

      const raw = (res.choices?.[0]?.message?.content as string) ?? '{"action":"HOLD"}';
      const jsonMatch = raw.match(/\{[\s\S]*?\}/);
      const parsed = JSON.parse(jsonMatch?.[0] ?? '{"action":"HOLD"}');
      const tradeLog = applyAction(state.portfolio, parsed, prices);
      const newPnl = getPnLBps(state.portfolio, prices);

      return {
        action: parsed,
        reasoning: parsed.reasoning ?? "",
        tradeLog,
        pnlBps: newPnl,
      };
    } catch (e) {
      return {
        action: { type: "HOLD" },
        reasoning: "parse error",
        tradeLog: "HOLD",
        pnlBps,
      };
    }
  }
}
