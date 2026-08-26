"use client";

import { useState, useEffect, useRef } from "react";

const AGENT_URL =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:3001")
    : "http://localhost:3001";

const AGENT_WS = AGENT_URL.replace(/^http/, "ws");

interface Message {
  role: "user" | "agent" | "system";
  content: string;
  timestamp: number;
}

interface AgentChatProps {
  duelId: number;
  isActive: boolean;
}

export function AgentChat({ duelId, isActive }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const addMsg = (role: Message["role"], content: string) =>
    setMessages((prev) => [...prev, { role, content, timestamp: Date.now() }]);

  // Connect WebSocket for live feed
  useEffect(() => {
    let ws: WebSocket;
    let dead = false;

    function connect() {
      if (dead) return;
      try {
        ws = new WebSocket(`${AGENT_WS}/feed/${duelId}`);

        ws.onmessage = (e) => {
          const event = JSON.parse(e.data);
          if (event.type === "connected") return;

          let content = "";
          if (event.type === "trade")
            content = `📊 ${event.data.tradeLog} — ${event.data.reasoning} (PnL: ${(event.data.pnlBps / 100).toFixed(2)}%)`;
          else if (event.type === "pnl")
            content = `✅ On-chain: ${(event.data.pnlBps / 100).toFixed(2)}%`;
          else if (event.type === "info" || event.type === "tick")
            content = `⚙️ ${event.data.message}`;
          else if (event.type === "end")
            content = `🏁 ${event.data.message}`;
          else if (event.type === "error")
            content = `⚠️ ${event.data.message}`;

          if (content) addMsg("system", content);
          if (event.type === "end") setAgentRunning(false);
          else if (event.type !== "connected") setAgentRunning(true);
        };

        ws.onerror = () => {
          // silently retry — agent server might not be running yet
        };
      } catch {
        // ignore connection errors
      }
    }

    connect();
    return () => {
      dead = true;
      ws?.close();
    };
  }, [duelId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput("");
    setSending(true);
    addMsg("user", msg);

    try {
      const endpoint = isActive
        ? `${AGENT_URL}/agent/duel/${duelId}/message`
        : `${AGENT_URL}/agent/chat`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duelId, message: msg }),
      });
      const data = await res.json();

      if (data.reply) addMsg("agent", data.reply);
      else if (data.ok) addMsg("system", "Message queued for next tick");
      // A server that answered with an error used to land here and do nothing:
      // your message appeared, then silence, which reads as a hang rather than
      // a failure.
      else if (data.error) addMsg("system", `⚠️ ${data.error}`);
      else addMsg("system", "⚠️ Agent server returned nothing usable");
    } catch {
      addMsg("system", "⚠️ Agent server unreachable — start it with: cd agent && npm start");
    } finally {
      setSending(false);
    }
  };

  const startAgent = async () => {
    try {
      await fetch(`${AGENT_URL}/agent/duel/${duelId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setAgentRunning(true);
      addMsg("system", "Agent started");
    } catch {
      addMsg("system", "⚠️ Cannot reach agent server (localhost:3001)");
    }
  };

  return (
    <div className="border border-zinc-800 rounded-lg flex flex-col" style={{ height: "360px" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${agentRunning ? "bg-[#00ff88]" : "bg-zinc-600"}`}
          />
          <span className="text-sm font-bold">Agent</span>
          {agentRunning && (
            <span className="text-[10px] text-[#00ff88] font-mono">LIVE</span>
          )}
        </div>
        {isActive && !agentRunning && (
          <button
            onClick={startAgent}
            className="text-xs font-bold px-3 py-1 bg-[#00ff88] text-black rounded hover:bg-[#00cc6a] transition-colors"
          >
            Start Agent
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5 text-xs font-mono">
        {messages.length === 0 && (
          <div className="text-zinc-600 text-center pt-6">
            {isActive
              ? 'Click "Start Agent" then send instructions'
              : "Define your strategy before the duel starts"}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <span
              className={`inline-block px-2 py-1 rounded max-w-[85%] text-left break-words ${
                m.role === "user"
                  ? "bg-[#00ff88]/15 text-[#00ff88]"
                  : m.role === "agent"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-500"
              }`}
            >
              {m.content}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 p-2.5 flex gap-2 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder={
            isActive ? "Adjust strategy mid-duel…" : "Set your strategy…"
          }
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-[#00ff88] transition-colors"
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="px-3 py-1.5 bg-[#00ff88] text-black text-xs font-bold rounded hover:bg-[#00cc6a] transition-colors disabled:opacity-40"
        >
          →
        </button>
      </div>
    </div>
  );
}
