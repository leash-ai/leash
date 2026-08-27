"use client";

import { useEffect, useRef, useState } from "react";

const AGENT_URL: string | null =
  process.env.NEXT_PUBLIC_AGENT_URL ||
  (process.env.NODE_ENV === "development" ? "http://localhost:3001" : null);

interface Msg { role: "user" | "assistant"; content: string }
interface Ready { name: string; strategy: string }

interface Props {
  onClose: () => void;
  onCreated: (name: string, strategy: string) => void;
}

const OPENING =
  "Tell me how you want to trade and I'll build you a bot. Aggressive on dips? " +
  "Ride whatever is running? Sit out unless something big moves? Say it however you like.";

const EXAMPLES = [
  "Aggressive — buy anything that starts running, cut it fast",
  "Patient — only act when something drops hard, then hold",
  "Spread across all three, small positions, no big bets",
];

/**
 * Make a bot by describing it.
 *
 * Picking from three preset strategies made the model decorative — it ran
 * something someone else had written. Here the conversation produces the brief
 * the trading agent follows, which is the difference between an AI feature and
 * an AI-shaped label.
 */
export function CreateBotModal({ onClose, onCreated }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [msgs, ready]);

  const send = async (text: string) => {
    const clean = text.trim();
    if (!clean || busy) return;
    if (!AGENT_URL) {
      setError("The bot designer needs an agent server. Set NEXT_PUBLIC_AGENT_URL.");
      return;
    }

    const next = [...msgs, { role: "user" as const, content: clean }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`${AGENT_URL}/agent/bot/design`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();

      if (data.error) { setError(data.error); return; }
      setMsgs([...next, { role: "assistant", content: data.reply }]);
      if (data.ready && data.name && data.strategy) {
        setReady({ name: data.name, strategy: data.strategy });
      }
    } catch {
      setError("Could not reach the agent server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 w-full max-w-lg flex flex-col" style={{ maxHeight: "88vh" }}>
        <h2 className="text-xl font-bold mb-1">Create a bot</h2>
        <p className="text-xs text-zinc-500 font-mono mb-4">
          Describe how it should trade. It runs on your machine — nobody sees it, not even
          your opponent.
        </p>

        <div className="flex-1 overflow-y-auto space-y-3 mb-4 min-h-[180px]">
          {msgs.length === 0 && (
            <>
              <div className="text-sm text-zinc-400 leading-relaxed">{OPENING}</div>
              <div className="space-y-2 pt-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => send(ex)}
                    className="w-full text-left text-xs font-mono text-zinc-500 border border-zinc-800 rounded-lg px-3 py-2 hover:border-zinc-600 hover:text-zinc-300 transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </>
          )}

          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-right" : ""}>
              <span
                className={`inline-block text-sm rounded-lg px-3 py-2 max-w-[85%] text-left ${
                  m.role === "user" ? "bg-zinc-800 text-zinc-200" : "text-zinc-400"
                }`}
              >
                {m.content}
              </span>
            </div>
          ))}

          {busy && <div className="text-xs font-mono text-zinc-600">thinking…</div>}
          {error && <div className="text-xs font-mono text-red-400">⚠️ {error}</div>}

          {ready && (
            <div className="border border-[#00ff88] rounded-lg p-4 mt-2">
              <div className="text-[10px] font-mono text-[#00ff88] mb-1">YOUR BOT</div>
              <div className="font-bold text-lg mb-2">{ready.name}</div>
              <p className="text-xs text-zinc-500 font-mono leading-relaxed">{ready.strategy}</p>
            </div>
          )}
          <div ref={bottom} />
        </div>

        {ready ? (
          <div className="flex gap-3">
            <button
              onClick={() => onCreated(ready.name, ready.strategy)}
              className="flex-1 bg-[#00ff88] text-black font-bold py-3 rounded-lg hover:bg-[#00cc6a] transition-colors"
            >
              Save {ready.name}
            </button>
            <button
              onClick={() => setReady(null)}
              className="px-4 border border-zinc-700 rounded-lg text-zinc-400 hover:border-zinc-500 text-sm transition-colors"
            >
              Keep tweaking
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
              placeholder="How should it trade?"
              disabled={busy}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#00ff88] transition-colors disabled:opacity-50"
            />
            <button
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              className="px-4 bg-[#00ff88] text-black font-bold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              →
            </button>
          </div>
        )}

        <button onClick={onClose} className="text-xs text-zinc-600 hover:text-zinc-400 mt-3 self-center">
          Cancel
        </button>
      </div>
    </div>
  );
}
