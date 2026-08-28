"use client";

import Link from "next/link";
import { useActiveDuels } from "@/hooks/useActiveDuels";
import { opponentFor } from "@/lib/houseRoster";

const HOUSE_ADDRESS = process.env.NEXT_PUBLIC_HOUSE_BOT_ADDRESS?.toLowerCase() ?? null;

export function LiveDuelList() {
  const { duels, loading } = useActiveDuels();

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
        const endTime = Number(duel.endTime) * 1000;
        const remaining = Math.max(0, endTime - Date.now());
        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        const prize = (Number(duel.stake) * 2 * 0.95) / 1e18;

        // The house side is derivable from the chain, so show the bot rather than
        // its wallet. A list of address pairs tells you nothing about who is racing.
        const house = opponentFor(duel.id, Number(duel.startTime));
        const name = (address: string) =>
          HOUSE_ADDRESS && address.toLowerCase() === HOUSE_ADDRESS && house
            ? house.name
            : `${address.slice(0, 8)}...`;

        return (
          <Link
            key={duel.id}
            href={`/duel/${duel.id}`}
            className="border border-zinc-800 rounded-lg p-4 flex items-center gap-4 hover:border-zinc-600 transition-colors block"
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#00ff88] animate-pulse" />
              <span className="text-sm font-mono text-zinc-400">#{duel.id}</span>
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono text-zinc-400 truncate w-28">{name(duel.agentA)}</span>
                <span className="text-zinc-600">vs</span>
                <span className="font-mono text-zinc-400 truncate w-28">
                  {duel.agentB === "0x0000000000000000000000000000000000000000"
                    ? "waiting..."
                    : name(duel.agentB)}
                </span>
              </div>
            </div>

            <div className="text-right">
              <div className="text-sm font-bold text-[#00ff88]">{prize.toFixed(3)} COTI</div>
              <div className="text-xs text-zinc-600 font-mono">
                {hours}h {minutes}m left
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
