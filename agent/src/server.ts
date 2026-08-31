import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import * as http from "http";
import * as dotenv from "dotenv";
dotenv.config();

import { TradingAgent, createAgentState, AgentState } from "./ai_agent";
import { runDuel, FeedEvent } from "./runner";
import { unreachableTriggers, rescaleRequest } from "./strategyScale";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

interface DuelEntry {
  state: AgentState;
  clients: Set<WebSocket>;
  running: boolean;
}

const duels = new Map<number, DuelEntry>();
const ai = new TradingAgent();

function getOrCreate(duelId: number): DuelEntry {
  if (!duels.has(duelId)) {
    duels.set(duelId, { state: createAgentState(), clients: new Set(), running: false });
  }
  return duels.get(duelId)!;
}

/**
 * Agent events go to the browser — and to the terminal.
 *
 * They used to go only to whoever had the websocket open, which meant a duel
 * that failed with nobody watching failed in silence: the process log stayed
 * empty and the only symptom was a flat curve. An agent quitting because the
 * duel was still Open sat undiagnosed behind exactly that.
 *
 * Trades and ticks are left out. They arrive every few seconds per duel and the
 * feed is where they belong; what the terminal needs is what went wrong.
 */
function broadcast(duelId: number, event: FeedEvent) {
  if (event.type === "error" || event.type === "info" || event.type === "end") {
    const stamp = new Date().toTimeString().slice(0, 8);
    const detail = (event.data as { message?: string })?.message ?? event.type;
    console.log(`[${stamp}] duel ${duelId} — ${detail}`);
  }

  const entry = duels.get(duelId);
  if (!entry) return;
  const msg = JSON.stringify(event);
  for (const ws of entry.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// WebSocket: /feed/:duelId
wss.on("connection", (ws, req) => {
  const match = req.url?.match(/\/feed\/(\d+)/);
  if (!match) {
    ws.close();
    return;
  }
  const duelId = Number(match[1]);
  const entry = getOrCreate(duelId);
  entry.clients.add(ws);
  ws.on("close", () => entry.clients.delete(ws));
  ws.send(JSON.stringify({ type: "connected", timestamp: Date.now(), data: { duelId } }));
});

// POST /agent/chat — pre-duel strategy chat
app.post("/agent/chat", async (req, res) => {
  const { duelId, message } = req.body as { duelId?: number; message?: string };
  if (!message) return res.status(400).json({ error: "message required" });

  const id = duelId ?? 0;
  const entry = getOrCreate(id);

  try {
    const reply = await ai.chat(entry.state, message);
    res.json({ reply, strategy: entry.state.strategy });
  } catch (e: any) {
    // Say what the operator can act on rather than forwarding the provider's
    // raw body to a browser. A 402 here means the Mistral key has no credit —
    // nothing about the deployment or the duel is wrong, and the message used
    // to arrive as an unreadable API dump.
    const raw = String(e?.message ?? "");
    const keyVar = process.env.AI_BASE_URL ? "AI_API_KEY" : "MISTRAL_API_KEY";
    const unusable =
      raw.includes("No LLM configured") ||
      raw.includes("402") ||
      /subscription|quota|credit|insufficient|401|403|unauthor/i.test(raw);
    res.status(unusable ? 503 : 500).json({
      error: unusable
        ? `The strategy chat needs a working ${keyVar}. Everything else works without it — the agent still trades on its configured strategy and settlement is unaffected.`
        : `Agent error: ${raw.slice(0, 160)}`,
    });
  }
});

/**
 * POST /agent/bot/design — build a bot by talking about it.
 *
 * The duel form used to offer three fixed strategies, which made the model
 * decorative: it ran a preset someone else wrote. Here the conversation is the
 * point — you describe how you want to trade and this turns it into the brief
 * the trading agent will actually follow.
 *
 * The model answers as JSON so the reply and the finished bot arrive together;
 * `ready` is what tells the UI it has enough to save. If it comes back
 * unparseable the text is still shown, because a chat that says nothing is worse
 * than a chat that says something unstructured.
 */
const DESIGNER_PROMPT = `You help someone design an automated trading bot for a short duel — minutes, not days — on BTC, ETH and SOL.

Ask at most one short clarifying question. As soon as you have a usable idea, produce the bot: do not interrogate.

Reply with JSON only, no prose outside it:
{"reply":"<one or two sentences to the user>","ready":<true|false>,"name":"<2-3 word bot name>","strategy":"<precise instruction the trading agent follows: what to buy, when, how big, when to exit>"}

Set ready=false only while you are still asking. When ready=true, name and strategy must both be filled in. Keep strategy concrete and self-contained — it is handed to another agent with no memory of this conversation.

If a bot already appears earlier in this conversation and the user asks for
something better, different, or refined, produce a genuinely different bot: a new
name, and a mechanism that is not the previous one reworded. Changing the prose
while keeping the same trigger, the same sizing and the same exit is not a new
bot. Never reuse a name you have already proposed here.

The bot you design is handed to an agent that sees only spot prices for BTC, ETH,
SOL, BNB and AVAX, refreshed every 15 to 30 seconds, and can BUY or SELL a
percentage of its position. There is no order book, no volume, no leverage, no
shorting, no limit orders and no indicator it has not computed from those prices
itself. A strategy that needs any of those cannot be run, and the agent will hold
instead. Write triggers the agent can evaluate from a short recent price history.

Size every threshold to what a duel actually contains. These last two to ten
minutes, and spot crypto moves roughly 0.05% to 0.3% over that span — not 2%, not
5%. A trigger written for a daily chart never fires: the agent holds every tick,
the duel ends at 0.00%, and the person watching sees a flat line. Put entry
triggers around 0.05% to 0.2%, exits tighter still, and lookbacks of two to six
price points rather than tens.

Design for a bot that acts. A duel is short and a bot that waits for a perfect
setup will not get one. Prefer a strategy that takes a position in the first
minute and keeps adjusting: something to watch beats something correct that never
fires. Position sizes of 50% to 100% of
cash are normal for a game this short — a 5% position cannot show up before the
clock stops.`;

app.post("/agent/bot/design", async (req, res) => {
  const { messages } = req.body as { messages?: { role: string; content: string }[] };
  if (!messages?.length) return res.status(400).json({ error: "messages required" });

  try {
    let reply = await ai.design(DESIGNER_PROMPT, messages.slice(-12));

    /*
      One corrective turn when the triggers cannot fire.

      The prompt says to size thresholds for a duel and the model keeps writing
      1.5% and 2% anyway — numbers off a daily chart. A bot with those holds
      every tick and finishes flat, which reads as a broken product rather than
      a badly tuned bot. Asking again with the offending numbers quoted works
      where the rule alone did not.
    */
    const offenders = reply.ready ? unreachableTriggers(reply.strategy ?? "") : [];
    if (offenders.length > 0) {
      const retry = await ai.design(DESIGNER_PROMPT, [
        ...messages.slice(-12),
        { role: "assistant", content: JSON.stringify(reply) },
        { role: "user", content: rescaleRequest(offenders) },
      ]);
      // Only if it actually helped — a second unusable answer is not an
      // improvement, and the first at least came from what the user asked for.
      if (retry.ready && unreachableTriggers(retry.strategy ?? "").length === 0) {
        reply = retry;
      }
    }

    res.json(reply);
  } catch (e: any) {
    const raw = String(e?.message ?? "");
    const keyVar = process.env.AI_BASE_URL ? "AI_API_KEY" : "MISTRAL_API_KEY";
    const unusable =
      raw.includes("No LLM configured") || raw.includes("402") ||
      /subscription|quota|credit|insufficient|401|403|unauthor/i.test(raw);
    res.status(unusable ? 503 : 500).json({
      error: unusable
        ? `Designing a bot needs a working ${keyVar}.`
        : `Agent error: ${raw.slice(0, 160)}`,
    });
  }
});

// POST /agent/duel/:id/start — start agent loop for this duel
/**
 * What each preset means, spelled out for the model.
 *
 * The duel page sends an id, not a paragraph. Turning it into an instruction
 * here keeps the three presets behaving the same way every time rather than
 * depending on how a caller happened to phrase it.
 */
const STRATEGY_BRIEFS: Record<string, string> = {
  momentum:
    "Momentum: buy the asset with the strongest recent gain and hold it while it keeps climbing. Size around 25% of cash per position.",
  meanReversion:
    "Mean reversion: buy what has fallen furthest against its recent average, expecting a bounce. Size around 25% of cash per position.",
  marketMaker:
    "Market making: work both sides, take small edges, avoid large directional bets. Keep positions modest.",
};

app.post("/agent/duel/:id/start", async (req, res) => {
  const duelId = Number(req.params.id);
  const { signerKey, strategy } = req.body as { signerKey?: string; strategy?: string };
  const entry = getOrCreate(duelId);

  if (strategy) {
    entry.state.strategy = STRATEGY_BRIEFS[strategy] ?? strategy;
  }

  if (entry.running) {
    return res.json({ ok: true, message: "already running" });
  }

  entry.running = true;
  entry.state.duelId = duelId;

  runDuel(duelId, entry.state, (event) => {
    broadcast(duelId, event);
    if (event.type === "end") entry.running = false;
  }, signerKey).catch((e) => {
    broadcast(duelId, { type: "error", timestamp: Date.now(), data: { message: e.message } });
    entry.running = false;
  });

  res.json({ ok: true, duelId });
});

/**
 * POST /agent/duel/:id/mark — the opponent's score, between transactions.
 *
 * The house bot runs in its own process, so it cannot emit onto this server's
 * feed directly. It posts its mark here instead and this forwards it, which is
 * the only way both curves move at the same resolution: the agent marks its own
 * side in-process, the house bot marks its side over one local request.
 *
 * Nothing here is authoritative. Marks are for watching; what settles is what
 * each agent published on-chain, and submitFinalPnL pins the encrypted score to
 * that. A dropped mark costs a frame of animation and nothing else, which is why
 * this neither authenticates nor retries.
 */
app.post("/agent/duel/:id/mark", (req, res) => {
  const duelId = Number(req.params.id);
  const { side, pnlBps } = req.body as { side?: "A" | "B"; pnlBps?: number };
  if ((side !== "A" && side !== "B") || typeof pnlBps !== "number") {
    return res.status(400).json({ error: "side and pnlBps required" });
  }
  broadcast(duelId, { type: "mark", timestamp: Date.now(), data: { side, pnlBps } });
  res.json({ ok: true });
});

// POST /agent/duel/:id/message — send mid-duel instruction
app.post("/agent/duel/:id/message", async (req, res) => {
  const duelId = Number(req.params.id);
  const { message } = req.body as { message?: string };
  if (!message) return res.status(400).json({ error: "message required" });

  const entry = getOrCreate(duelId);
  entry.state.pendingMessages.push(message);
  res.json({ ok: true, queued: entry.state.pendingMessages.length });
});

// GET /agent/duel/:id/status
app.get("/agent/duel/:id/status", (req, res) => {
  const duelId = Number(req.params.id);
  const entry = duels.get(duelId);
  if (!entry) return res.json({ running: false, strategy: "", portfolio: null });
  res.json({
    running: entry.running,
    strategy: entry.state.strategy,
    portfolio: entry.state.portfolio,
    chatHistory: entry.state.chatHistory.slice(-10),
  });
});

// Health check
app.get("/health", (_, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, () =>
  console.log(`Leash agent server running on :${PORT}`)
);
