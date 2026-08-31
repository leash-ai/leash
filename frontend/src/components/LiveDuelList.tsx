"use client";

import Link from "next/link";
import { useActiveDuels } from "@/hooks/useActiveDuels";
import { opponentFor } from "@/lib/houseRoster";
import { useMyBots } from "@/hooks/useMyBots";

const HOUSE_ADDRESS = process.env.NEXT_PUBLIC_HOUSE_BOT_ADDRESS?.toLowerCase() ?? null;


/** One side of a row: who, and where they stand. */
function Corner({
  name,
  score,
  ahead,
  align = "left",
}: {
  name: string;
  score: string | null;
  ahead: boolean;
  align?: "left" | "right";
}) {
  return (
    <div className={`flex items-baseline gap-2.5 min-w-0 ${align === "right" ? "justify-end" : ""}`}>
      <span className={`font-mono text-sm truncate ${ahead ? "text-white" : "text-zinc-400"}`}>
        {name}
      </span>
      {score && (
        <span
          className={`font-mono text-xs tabular-nums shrink-0 ${
            ahead ? "text-[#00ff88]" : "text-zinc-600"
          }`}
        >
          {score}
        </span>
      )}
    </div>
  );
}

export function LiveDuelList() {
  const { duels, loading } = useActiveDuels();
  const { bots } = useMyBots();

  if (loading) {
    return <div className="text-zinc-600 font-mono text-sm">Fetching live duels...</div>;
  }

  if (duels.length === 0) {
    return (
      <div className="border border-zinc-800 rounded-lg p-12 text-center">
        <div className="text-zinc-700 font-mono text-sm">No active duels. Create one to start.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {duels.map((duel) => {
        /*
          A duel nobody has joined has no clock.

          endTime holds the raw duration until someone joins, so an open duel was
          rendering "0h 0m left" — a countdown that had already expired for a
          duel that had not started. Waiting and nearly over look the same at a
          glance, and only one of them is true.
        */
        const open = duel.state === 0;
        const endTime = Number(duel.endTime) * 1000;
        const remaining = open ? 0 : Math.max(0, endTime - Date.now());
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const prize = (Number(duel.stake) * 2 * 0.95) / 1e18;

        // Names on both sides where there are names. The house side is derivable
        // from the chain; your side is the bot this browser remembers sending.
        // A list of address pairs tells you nothing about who is racing, and
        // naming only the opponent made your own duel look like a stranger's.
        const house = opponentFor(duel.id, Number(duel.startTime));
        const mine = bots.find((b) => b.duelIds.includes(duel.id));
        const name = (address: string, isCreator: boolean) => {
          if (HOUSE_ADDRESS && address.toLowerCase() === HOUSE_ADDRESS && house) return house.name;
          if (isCreator && mine) return mine.name;
          return `${address.slice(0, 8)}...`;
        };

        const score = (bps: number | null) =>
          bps === null ? null : `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;

        const ahead =
          duel.pnlA !== null && duel.pnlB !== null
            ? duel.pnlA > duel.pnlB
              ? "a"
              : duel.pnlA < duel.pnlB
                ? "b"
                : null
            : null;

        return (
          <Link
            key={duel.id}
            href={`/duel/${duel.id}`}
            className="group border border-zinc-800 rounded-xl px-5 py-4 flex items-center gap-5 hover:border-zinc-600 hover:bg-zinc-900/40 transition-colors block"
          >
            <span className="text-xs font-mono text-zinc-600 w-8 shrink-0 group-hover:text-zinc-400 transition-colors">
              #{duel.id}
            </span>

            {/* The scoreboard. Whoever is ahead is the only thing in colour. */}
            <div className="flex-1 grid grid-cols-[1fr_auto_1fr] items-center gap-4 min-w-0">
              <Corner name={name(duel.agentA, true)} score={score(duel.pnlA)} ahead={ahead === "a"} />
              <span className="text-[10px] font-mono text-zinc-700 tracking-widest">VS</span>
              {open ? (
                <span className="text-sm font-mono text-zinc-600 text-right">waiting for an opponent…</span>
              ) : (
                <Corner
                  name={name(duel.agentB, false)}
                  score={score(duel.pnlB)}
                  ahead={ahead === "b"}
                  align="right"
                />
              )}
            </div>

            <div className="text-right shrink-0 w-28">
              <div className="text-sm font-bold text-[#00ff88] tabular-nums">
                {prize.toFixed(3)} COTI
              </div>
              <div className="text-[11px] text-zinc-600 font-mono tabular-nums">
                {open ? (
                  <span className="text-yellow-500/80">open</span>
                ) : (
                  `${mins}:${String(secs).padStart(2, "0")} left`
                )}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
