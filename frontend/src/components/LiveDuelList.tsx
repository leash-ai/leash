"use client";

import Link from "next/link";
import { useActiveDuels } from "@/hooks/useActiveDuels";

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
                <span className="font-mono text-zinc-400 truncate w-24">{duel.agentA.slice(0, 8)}...</span>
                <span className="text-zinc-600">vs</span>
                <span className="font-mono text-zinc-400 truncate w-24">
                  {duel.agentB === "0x0000000000000000000000000000000000000000"
                    ? "waiting..."
                    : `${duel.agentB.slice(0, 8)}...`}
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
