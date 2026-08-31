"use client";

import { useState, useEffect, useRef } from "react";

/**
 * Where the agent server lives, or null when there is none.
 *
 * This used to fall back to http://localhost:3001 unconditionally. On a hosted
 * build that means every visitor's browser reaching for *their own* machine:
 * console errors on a page that looks live, or a request landing on whatever
 * else they happen to be running on 3001. The agent server is a long-lived
 * process with a WebSocket, so it is not on the same host as a static frontend
 * anyway — it has to be pointed at explicitly.
 *
 * localhost stays as a development convenience, where it is the right guess.
 */
const AGENT_URL: string | null =
  process.env.NEXT_PUBLIC_AGENT_URL ||
  (process.env.NODE_ENV === "development" ? "http://localhost:3001" : null);

const AGENT_WS = AGENT_URL ? AGENT_URL.replace(/^http/, "ws") : null;

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
  const [thinking, setThinking] = useState(false);
  const lastPublished = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const addMsg = (role: Message["role"], content: string) =>
    setMessages((prev) => [...prev, { role, content, timestamp: Date.now() }]);

  /**
   * One line per decision, not three.
   *
   * Every tick used to log "Thinking…", then the decision, then the on-chain
   * confirmation — and the decision is HOLD most of the time, because that is
   * what a strategy does when nothing is happening. Three lines of it per tick
   * buried the ones that mattered.
   *
   * Consecutive repeats collapse into a count. Matching on the whole string does
   * not work: the model rewords its reasoning every tick, so "HOLD — no strong 2m
   * gain" and "HOLD — no clear 2m momentum leader" are the same non-event written
   * twice. The action is what repeats, so that is what is compared.
   */
  const actionOf = (line: string) => line.split(" — ")[0].trim().toUpperCase();

  const addDecision = (content: string) =>
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "system" && actionOf(last.content) === actionOf(content)) {
        const times = Number(last.content.match(/ ×(\d+)$/)?.[1] ?? 1) + 1;
        return [
          ...prev.slice(0, -1),
          { ...last, content: `${content} ×${times}`, timestamp: Date.now() },
        ];
      }
      return [...prev, { role: "system" as const, content, timestamp: Date.now() }];
    });

  // Connect WebSocket for live feed
  useEffect(() => {
    if (!AGENT_WS) return;   // nothing to connect to; the panel says so below

    let ws: WebSocket | undefined;
    let dead = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;

    function connect() {
      if (dead) return;
      try {
        ws = new WebSocket(`${AGENT_WS}/feed/${duelId}`);

        ws.onmessage = (e) => {
          const event = JSON.parse(e.data);
          if (event.type === "connected") return;

          // "Thinking…" is a state, not an entry in a log.
          if (event.type === "tick") {
            setThinking(true);
            setAgentRunning(true);
            return;
          }

          if (event.type === "trade") {
            setThinking(false);
            setAgentRunning(true);
            addDecision(
              `${event.data.tradeLog} — ${event.data.reasoning} (${(event.data.pnlBps / 100).toFixed(2)}%)`,
            );
            return;
          }

          // The confirmation only carries news when the number moved. Repeating
          // an unchanged score every tick is the loudest line for the least.
          if (event.type === "pnl") {
            const bps = event.data.pnlBps as number;
            if (lastPublished.current !== bps) {
              lastPublished.current = bps;
              addDecision(`ON-CHAIN — ${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(2)}% published`);
            }
            setAgentRunning(true);
            return;
          }

          let content = "";
          if (event.type === "info") content = event.data.message;
          else if (event.type === "end") content = event.data.message;
          else if (event.type === "error") content = `! ${event.data.message}`;

          if (content) addMsg("system", content);
          if (event.type === "end") {
            setAgentRunning(false);
            setThinking(false);
          } else if (event.type !== "connected") setAgentRunning(true);
        };

        ws.onopen = () => {
          delay = 1000;
        };

        // The comment here used to say "silently retry — agent server might not
        // be running yet", and nothing retried. Starting the agent server after
        // opening the page left the feed dead until a reload, which is the
        // ordinary order of events when someone brings the stack up.
        ws.onclose = () => {
          if (dead) return;
          retry = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 10_000);
        };

        ws.onerror = () => {
          // onclose always follows; retrying here too would double the attempts.
        };
      } catch {
        if (!dead) {
          retry = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 10_000);
        }
      }
    }

    connect();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [duelId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || sending || !AGENT_URL) return;
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
      else if (data.error) addMsg("system", `! ${data.error}`);
      else addMsg("system", "! Agent server returned nothing usable");
    } catch {
      addMsg("system", "! Agent server unreachable — start it with: cd agent && npm start");
    } finally {
      setSending(false);
    }
  };

  const startAgent = async () => {
    if (!AGENT_URL) return;
    try {
      await fetch(`${AGENT_URL}/agent/duel/${duelId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setAgentRunning(true);
      addMsg("system", "Agent started");
    } catch {
      addMsg("system", "! Cannot reach agent server (localhost:3001)");
    }
  };

  if (!AGENT_URL) {
    return (
      <div className="border border-track-line rounded-lg bg-track-soft p-6">
        <div className="text-sm font-bold mb-2">Agent</div>
        <p className="text-xs text-ink-faint font-mono leading-relaxed">
          The live agent feed needs an agent server, which runs as a long-lived
          process rather than alongside this site. Set{" "}
          <span className="text-ink-dim">NEXT_PUBLIC_AGENT_URL</span> to point at
          one.
          <br />
          <br />
          It is not only the feed that is missing: your side of this duel is what
          the agent server drives, so without one your bot posts nothing and the
          curve above stays flat. The house bot is rules in its own process and
          plays either way.
          <br />
          <br />
          Everything else on this page is read straight from the chain and does
          not depend on it — scores, settlement and resolution all work without an
          agent server.
        </p>
      </div>
    );
  }

  return (
    // Grows with the feed up to a ceiling, rather than reserving 360px whatever
    // is in it — early in a duel that was four lines above a field of black.
    <div className="border border-track-line rounded-xl flex flex-col max-h-[360px] min-h-[180px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-track-line shrink-0">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${agentRunning ? "bg-best" : "bg-zinc-600"}`}
          />
          <span className="text-sm font-bold">Agent</span>
          {agentRunning && (
            <span className="text-[10px] text-best font-mono">
              {thinking ? "THINKING…" : "LIVE"}
            </span>
          )}
        </div>
        {isActive && !agentRunning && (
          <button
            onClick={startAgent}
            className="text-xs font-bold px-3 py-1 bg-best text-black rounded hover:bg-[#9F80FF] transition-colors"
          >
            Start Agent
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 text-xs font-mono">
        {messages.length === 0 && (
          <div className="text-ink-faint text-center pt-6">
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
                  ? "bg-best/15 text-best"
                  : m.role === "agent"
                  ? "bg-zinc-800 text-white"
                  : "text-ink-faint"
              }`}
            >
              {m.content}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-track-line p-2.5 flex gap-2 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder={
            isActive ? "Adjust strategy mid-duel…" : "Set your strategy…"
          }
          className="flex-1 bg-track-soft border border-track-edge rounded px-3 py-1.5 text-xs focus:outline-none focus:border-best transition-colors"
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="px-3 py-1.5 bg-best text-black text-xs font-bold rounded hover:bg-[#9F80FF] transition-colors disabled:opacity-40"
        >
          →
        </button>
      </div>
    </div>
  );
}
