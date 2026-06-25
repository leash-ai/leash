"use client";

import Link from "next/link";

interface DuelCardProps {
  id: number;
  agentA: string;
  agentB?: string;
  stake: string;
  pnlA?: number;
  pnlB?: number;
  endTime: number;
  state: 0 | 1 | 2 | 3;
  winner?: string;
}

const STATE_LABEL: Record<number, string> = {
  0: "Open",
  1: "Live",
  2: "Resolving",
  3: "Done",
};

const STATE_DOT: Record<number, string> = {
  0: "bg-yellow-400",
  1: "bg-[#00ff88] animate-pulse",
  2: "bg-blue-400",
  3: "bg-zinc-600",
};

export function DuelCard({ id, agentA, agentB, stake, pnlA = 0, pnlB = 0, endTime, state, winner }: DuelCardProps) {
  const remaining = Math.max(0, endTime - Date.now());
  const hours = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);
  const noOpponent = !agentB || agentB === "0x0000000000000000000000000000000000000000";
  const aLeading = pnlA > pnlB;

  return (
    <Link href={`/duel/${id}`}>
      <div className="border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 transition-all cursor-pointer group">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${STATE_DOT[state]}`} />
            <span className="text-xs text-zinc-500 font-mono">{STATE_LABEL[state]}</span>
          </div>
          <span className="text-xs text-zinc-600 font-mono">#{id}</span>
        </div>

        <div className="flex items-center gap-3 mb-4">
          {/* Agent A */}
          <div className={`flex-1 rounded-lg p-3 border ${aLeading && state === 1 ? "border-[#00ff88]/40 bg-[#00ff88]/5" : "border-zinc-800"}`}>
            <div className="text-xs text-zinc-600 mb-1">A</div>
            <div className="font-mono text-xs text-zinc-400 truncate">{agentA.slice(0, 10)}...</div>
            {state >= 1 && (
              <div className={`text-sm font-bold mt-1 tabular-nums ${pnlA >= 0 ? "text-[#00ff88]" : "text-[#ff3b3b]"}`}>
                {pnlA >= 0 ? "+" : ""}{(pnlA / 100).toFixed(2)}%
              </div>
            )}
          </div>

          <div className="text-zinc-700 font-bold text-sm">VS</div>

          {/* Agent B */}
          <div className={`flex-1 rounded-lg p-3 border ${!aLeading && state === 1 && !noOpponent ? "border-[#3b9eff]/40 bg-[#3b9eff]/5" : "border-zinc-800"}`}>
            {noOpponent ? (
              <div className="text-xs text-zinc-700 text-center py-1">Open slot</div>
            ) : (
              <>
                <div className="text-xs text-zinc-600 mb-1">B</div>
                <div className="font-mono text-xs text-zinc-400 truncate">{agentB!.slice(0, 10)}...</div>
                {state >= 1 && (
                  <div className={`text-sm font-bold mt-1 tabular-nums ${pnlB >= 0 ? "text-[#00ff88]" : "text-[#ff3b3b]"}`}>
                    {pnlB >= 0 ? "+" : ""}{(pnlB / 100).toFixed(2)}%
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-zinc-600 font-mono">
          <span>Stake: {stake} COTI each</span>
          {state === 3 && winner ? (
            <span className="text-[#00ff88]">Winner: {winner.slice(0, 8)}...</span>
          ) : state === 1 ? (
            <span>{hours}h {mins}m left</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
