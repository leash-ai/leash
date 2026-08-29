"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import { useMyBots, Bot } from "@/hooks/useMyBots";
import { BotBuilder } from "@/components/BotBuilder";
import { HOUSE_ROSTER } from "@/lib/houseRoster";
import { useWallet } from "@/context/WalletContext";

const DM_ABI = [
  "function getDuel(uint256) view returns (address agentA, address agentB, uint256 stake, uint256 startTime, uint256 endTime, uint8 state, address winner, bool agentASubmitted, bool agentBSubmitted, uint256 createdAt)",
];

/** Named BotRecord, not Record — the latter is TypeScript's own generic. */
interface BotRecord { played: number; won: number; running: number }

/**
 * One saved bot, with what it has done.
 *
 * Defined here rather than inside BotsPage. A component declared in another
 * component's body is a new function identity on every render, so React treats
 * it as a different type and unmounts the whole subtree instead of updating it —
 * every card is destroyed and rebuilt each time any state on the page changes.
 */
function BotCard({
  bot,
  record,
  onDelete,
}: {
  bot: Bot;
  record?: BotRecord;
  onDelete: (id: string) => void;
}) {
  const r = record;
  return (
    <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-950 flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-bold text-lg">{bot.name}</h3>
        <button
          onClick={() => onDelete(bot.id)}
          className="text-[11px] font-mono text-zinc-700 hover:text-red-400 transition-colors shrink-0"
        >
          delete
        </button>
      </div>

      <p className="text-xs text-zinc-500 font-mono leading-relaxed flex-1">{bot.strategy}</p>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-800">
        <span className="text-xs font-mono text-zinc-500">
          {!r || (r.played === 0 && r.running === 0)
            ? "no duels yet"
            : `${r.won}W — ${r.played - r.won}L${r.running ? ` · ${r.running} running` : ""}`}
        </span>
        <Link
          href="/?duel=1"
          className="text-xs font-mono text-[#00ff88] hover:underline"
        >
          send it out →
        </Link>
      </div>
    </div>
  );
}

/**
 * Where a bot comes from and what it has done.
 *
 * The builder lived inside the duel form, which made it a step on the way to
 * something else. It is the opposite: the bot is the thing you own and reuse,
 * the duel is what you spend it on. So it gets a page, with what each one has
 * won, and the house side visible — you should be able to see who you might be
 * put against before you agree to play.
 */
export default function BotsPage() {
  const { bots, addBot, removeBot, loaded } = useMyBots();
  const { address } = useWallet();
  const [building, setBuilding] = useState(false);
  const [records, setRecords] = useState<Record<string, BotRecord>>({});

  // A bot's record is on-chain, keyed by the duels it was sent into.
  useEffect(() => {
    const dm = process.env.NEXT_PUBLIC_DUEL_MANAGER_ADDRESS;
    const ids = bots.flatMap((b) => b.duelIds);
    if (!dm || !address || ids.length === 0) return;
    let cancelled = false;

    (async () => {
      try {
        const provider = new ethers.JsonRpcProvider(
          process.env.NEXT_PUBLIC_COTI_RPC || "https://testnet.coti.io/rpc",
        );
        const contract = new ethers.Contract(dm, DM_ABI, provider);
        const seen = new Map<number, { state: number; winner: string }>();
        await Promise.all(
          [...new Set(ids)].map(async (id) => {
            try {
              const d = await contract.getDuel(id);
              seen.set(id, { state: Number(d.state), winner: String(d.winner) });
            } catch { /* a duel from another deployment simply has no record */ }
          }),
        );
        if (cancelled) return;

        const me = address.toLowerCase();
        const out: Record<string, BotRecord> = {};
        for (const b of bots) {
          const r = { played: 0, won: 0, running: 0 };
          for (const id of b.duelIds) {
            const d = seen.get(id);
            if (!d) continue;
            if (d.state === 2) { r.played++; if (d.winner.toLowerCase() === me) r.won++; }
            else r.running++;
          }
          out[b.id] = r;
        }
        setRecords(out);
      } catch { /* the page is still useful without records */ }
    })();

    return () => { cancelled = true; };
  }, [bots, address]);


  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-900 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-sm text-zinc-400 hover:text-white transition-colors">
          ← Back
        </Link>
        <span className="font-bold tracking-tight">LEASH</span>
        <Link href="/leaderboard" className="text-sm text-zinc-400 hover:text-white transition-colors">
          Leaderboard
        </Link>
      </header>

      <div className="flex-1 px-6 py-10 max-w-5xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-2">Your bots</h1>
        <p className="text-zinc-500 text-sm mb-8 max-w-xl">
          Describe how you want to trade and the AI writes the strategy. The bot is yours —
          take it into as many duels as you like.
        </p>

        {building ? (
          <div className="border border-zinc-800 rounded-xl p-6 bg-zinc-950 mb-10">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-bold">Build a bot</h2>
              <button
                onClick={() => setBuilding(false)}
                className="text-xs font-mono text-zinc-600 hover:text-zinc-400"
              >
                cancel
              </button>
            </div>
            <BotBuilder
              onCreated={(name, strategy) => {
                addBot(name, strategy);
                setBuilding(false);
              }}
            />
          </div>
        ) : (
          <button
            onClick={() => setBuilding(true)}
            className="bg-[#00ff88] text-black font-bold px-5 py-2.5 rounded-lg hover:bg-[#00cc6a] transition-colors mb-10"
          >
            + Build a bot
          </button>
        )}

        {loaded && bots.length === 0 && !building && (
          <div className="border border-dashed border-zinc-800 rounded-xl p-10 text-center mb-12">
            <p className="text-zinc-400 mb-1">No bots yet.</p>
            <p className="text-xs text-zinc-600 font-mono">
              Building one takes a sentence — say how it should trade.
            </p>
          </div>
        )}

        {bots.length > 0 && (
          <div className="grid md:grid-cols-2 gap-4 mb-16">
            {bots.map((b) => (
              <BotCard key={b.id} bot={b} record={records[b.id]} onDelete={removeBot} />
            ))}
          </div>
        )}

        <div className="border-t border-zinc-900 pt-10">
          <h2 className="text-xl font-bold mb-1">Who you might face</h2>
          <p className="text-zinc-500 text-sm mb-6 max-w-xl">
            The house keeps these six. One takes your challenge the moment you make it, and
            which one is random — so you cannot tune against the opponent in advance.
          </p>
          <div className="grid md:grid-cols-3 gap-3">
            {HOUSE_ROSTER.map((h) => (
              <div key={h.name} className="border border-zinc-800 rounded-lg p-4 bg-zinc-950">
                <div className="font-bold text-sm mb-1">{h.name}</div>
                <div className="text-xs text-zinc-500 font-mono leading-relaxed">{h.style}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
