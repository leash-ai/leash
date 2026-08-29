"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Where the design conversation is answered.
 *
 * A running agent server wins when one is configured — it already holds the
 * keys, and one place holding them is better than two. Otherwise this app
 * answers the call itself at /api/bot/design, because building a bot needs
 * neither a wallet nor the chain, and a deployed site that cannot do the one
 * thing the model is here for is not deployed.
 */
const DESIGN_URL: string =
  process.env.NEXT_PUBLIC_AGENT_URL
    ? `${process.env.NEXT_PUBLIC_AGENT_URL}/agent/bot/design`
    : "/api/bot/design";

interface Msg {
  role: "user" | "assistant";
  /** What is shown in the thread. */
  content: string;
  /** What the model actually produced on that turn, when it produced a bot. */
  bot?: Ready;
}
interface Ready { name: string; strategy: string }

interface Props {
  onCreated: (name: string, strategy: string) => void;
  /** Shown under the composer; the page and the modal want different words. */
  footer?: React.ReactNode;
}

const OPENING =
  "Tell me how you want to trade and I'll build you a bot. Aggressive on dips? " +
  "Ride whatever is running? Sit out unless something big moves? Say it however you like.";

const EXAMPLES = [
  "Aggressive — buy anything that starts running, cut it fast",
  "Patient — only act when something drops hard, then hold",
  "Spread across all three, small positions, no big bets",
  "Copy nothing, just follow the strongest trend of the last few minutes",
];

/**
 * The conversation that produces a bot.
 *
 * Separate from any modal chrome because this is the centre of the product, not
 * a dialog step: it is the whole reason there is a model in a trading app. The
 * bots page gives it a page; the duel form borrows it when you arrive without
 * one.
 */
/**
 * A turn as the model should see it.
 *
 * An assistant turn that produced a bot is sent as the JSON it emitted, so the
 * next turn knows the name and the mechanism it already used. Displaying that
 * JSON would be noise; withholding it from the model is what made every bot a
 * Sniper.
 */
const forModel = (m: Msg) => ({
  role: m.role,
  content: m.bot
    ? JSON.stringify({ reply: m.content, ready: true, name: m.bot.name, strategy: m.bot.strategy })
    : m.content,
});

export function BotBuilder({ onCreated, footer }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Braces on purpose. A concise arrow body returns whatever the expression
  // evaluates to, and React takes an effect's return value as its cleanup — so a
  // non-function slips through here and surfaces later as "destroy is not a
  // function" on unmount, pointing at react-dom internals rather than at this
  // line. An effect either returns a cleanup or returns nothing.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, ready]);

  const send = async (text: string) => {
    const clean = text.trim();
    if (!clean || busy) return;
    const next = [...msgs, { role: "user" as const, content: clean }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(DESIGN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The model gets back what it produced, not just what it said about it.
        // Only `reply` used to go into the history, so on the next turn it could
        // not see the bot it had just designed — it regenerated from scratch and
        // landed on the same name every time. Asking for something better got
        // the same bot with different prose.
        body: JSON.stringify({ messages: next.map(forModel) }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }

      const bot =
        data.ready && data.name && data.strategy
          ? { name: data.name as string, strategy: data.strategy as string }
          : undefined;

      setMsgs([...next, { role: "assistant", content: data.reply, bot }]);
      if (bot) setReady(bot);
    } catch {
      setError("Could not reach the designer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 mb-4 min-h-[220px]">
        {msgs.length === 0 && (
          <>
            <div className="text-sm text-zinc-400 leading-relaxed">{OPENING}</div>
            <div className="grid sm:grid-cols-2 gap-2 pt-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  className="text-left text-xs font-mono text-zinc-500 border border-zinc-800 rounded-lg px-3 py-2.5 hover:border-[#00ff88] hover:text-zinc-300 transition-colors"
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
        {error && <div className="text-xs font-mono text-red-400 leading-relaxed">! {error}</div>}

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
            className="px-5 bg-[#00ff88] text-black font-bold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            →
          </button>
        </div>
      )}

      {footer}
    </div>
  );
}
