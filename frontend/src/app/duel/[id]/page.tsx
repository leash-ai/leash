"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useDuel } from "@/hooks/useDuel";
import { ethers } from "ethers";

// DuelState enum: Open=0, Active=1, Resolved=2
const STATE_LABELS = ["Open", "Active", "Resolved"];
const STATE_COLORS = ["text-yellow-400", "text-green-400", "text-zinc-400"];

export default function DuelPage() {
  const { id } = useParams();
  const duelId = Number(id);
  const { duel, livePnL, loading } = useDuel(duelId);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-zinc-500 font-mono">Loading duel #{duelId}...</div>
      </div>
    );
  }

  if (!duel) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-400 font-mono">Duel #{duelId} not found</div>
      </div>
    );
  }

  const endTime = Number(duel.endTime) * 1000;
  const remaining = Math.max(0, endTime - now);
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  const stakeEth = Number(ethers.formatEther(duel.stake));
  const prize = stakeEth * 2 * 0.95; // 5% protocol fee

  const aWinning = livePnL.pnlA > livePnL.pnlB;
  const isResolved = duel.state === 2;
  const isActive = duel.state === 1;

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-sm text-zinc-500 hover:text-white transition-colors">
          ← Back
        </Link>
        <span className="font-bold tracking-tight">LEASH</span>
        <span className={`text-sm font-mono ${STATE_COLORS[duel.state] ?? "text-zinc-400"}`}>
          {STATE_LABELS[duel.state] ?? "Unknown"}
        </span>
      </header>

      <div className="flex-1 px-6 py-8 max-w-5xl mx-auto w-full">
        {/* Duel Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Duel #{duelId}</h1>
          {isActive && remaining > 0 && (
            <div className="font-mono text-2xl tabular-nums">
              {hours.toString().padStart(2, "0")}:
              {minutes.toString().padStart(2, "0")}:
              {seconds.toString().padStart(2, "0")}
              <span className="text-sm text-zinc-500 ml-2">remaining</span>
            </div>
          )}
        </div>

        {/* Agents vs Display */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {/* Agent A */}
          <div className={`border rounded-lg p-6 ${aWinning ? "border-[#00ff88]" : "border-zinc-800"}`}>
            <div className="text-xs text-zinc-500 mb-2">AGENT A</div>
            <div className="font-mono text-sm text-zinc-400 mb-4 truncate">{duel.agentA}</div>
            <div className={`text-3xl font-bold tabular-nums ${livePnL.pnlA >= 0 ? "text-[#00ff88]" : "text-[#ff3b3b]"}`}>
              {livePnL.pnlA >= 0 ? "+" : ""}{(livePnL.pnlA / 100).toFixed(2)}%
            </div>
            {aWinning && isActive && (
              <div className="text-xs text-[#00ff88] mt-2">● Leading</div>
            )}
          </div>

          {/* VS + Prize */}
          <div className="flex flex-col items-center justify-center border border-zinc-800 rounded-lg p-6">
            <div className="text-3xl font-bold text-zinc-600 mb-3">VS</div>
            <div className="text-sm text-zinc-500 mb-1">Prize pool</div>
            <div className="text-xl font-bold text-[#00ff88]">
              {prize.toFixed(4)} COTI
            </div>
            <div className="text-xs text-zinc-600 mt-1">winner takes all</div>
          </div>

          {/* Agent B */}
          <div className={`border rounded-lg p-6 ${!aWinning && duel.agentB !== ethers.ZeroAddress ? "border-[#00ff88]" : "border-zinc-800"}`}>
            <div className="text-xs text-zinc-500 mb-2">AGENT B</div>
            {duel.agentB === ethers.ZeroAddress ? (
              <div className="text-zinc-600 text-sm mt-2">Waiting for opponent...</div>
            ) : (
              <>
                <div className="font-mono text-sm text-zinc-400 mb-4 truncate">{duel.agentB}</div>
                <div className={`text-3xl font-bold tabular-nums ${livePnL.pnlB >= 0 ? "text-[#00ff88]" : "text-[#ff3b3b]"}`}>
                  {livePnL.pnlB >= 0 ? "+" : ""}{(livePnL.pnlB / 100).toFixed(2)}%
                </div>
                {!aWinning && isActive && (
                  <div className="text-xs text-[#00ff88] mt-2">● Leading</div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Resolution Banner */}
        {isResolved && duel.winner && duel.winner !== ethers.ZeroAddress && (
          <div className="border border-[#00ff88] rounded-lg p-6 mb-8">
            <div className="text-xs text-[#00ff88] mb-2">DUEL RESOLVED</div>
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏆</span>
              <div>
                <div className="font-bold text-lg">Winner</div>
                <div className="font-mono text-zinc-400">{duel.winner}</div>
              </div>
            </div>
          </div>
        )}

        {/* Privacy Note */}
        <div className="p-4 border border-zinc-800 rounded-lg bg-zinc-950">
          <p className="text-xs text-zinc-600 font-mono">
            🔒 Private by design: trade positions, asset allocations, and strategy logic are encrypted
            via COTI&apos;s Garbled Circuits. Only the final PnL comparison is computed on-chain —
            winner determined without revealing any underlying data.
          </p>
        </div>
      </div>
    </main>
  );
}
