import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import * as http from "http";
import * as dotenv from "dotenv";
dotenv.config();

import { MistralAgent, createAgentState, AgentState } from "./ai_agent";
import { runDuel, FeedEvent } from "./runner";

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
const ai = new MistralAgent();

function getOrCreate(duelId: number): DuelEntry {
  if (!duels.has(duelId)) {
    duels.set(duelId, { state: createAgentState(), clients: new Set(), running: false });
  }
  return duels.get(duelId)!;
}

function broadcast(duelId: number, event: FeedEvent) {
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
    const noCredit = raw.includes("402") || /subscription|quota|credit/i.test(raw);
    res.status(noCredit ? 503 : 500).json({
      error: noCredit
        ? "The strategy chat needs a funded MISTRAL_API_KEY — the current key has no credit. Everything else works without it; the agent still trades on its configured strategy."
        : `Agent error: ${raw.slice(0, 160)}`,
    });
  }
});

// POST /agent/duel/:id/start — start agent loop for this duel
app.post("/agent/duel/:id/start", async (req, res) => {
  const duelId = Number(req.params.id);
  const { signerKey } = req.body as { signerKey?: string };
  const entry = getOrCreate(duelId);

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
