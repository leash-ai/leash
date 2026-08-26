"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useDuel } from "@/hooks/useDuel";
import { AgentChat } from "@/components/AgentChat";
import { SettlementPanel } from "@/components/SettlementPanel";
import { DuelChart } from "@/components/DuelChart";
import { useDuelHistory } from "@/hooks/useDuelHistory";
import { ethers } from "ethers";

// DuelState enum: Open=0, Active=1, Resolved=2
const STATE_LABELS = ["Open", "Active", "Resolved"];
const STATE_COLORS = ["text-yellow-400", "text-green-400", "text-zinc-400"];

export default function DuelPage() {
  const { id } = useParams();
  const duelId = Number(id);
  const { duel, livePnL, settlement, loading, refresh } = useDuel(duelId);
  const [now, setNow] = useState(Date.now());
  // Re-read the curve on the same 15s cadence the duel data uses.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);
  const history = useDuelHistory(
    duelId,
    duel?.agentA,
    duel?.agentB,
    duel ? Number(duel.startTime) : undefined,
    tick,
  );

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

  // Only meaningful once both sides have actually reported something.
  const bothReported = duel.agentASubmitted && duel.agentBSubmitted;
  const aWinning = livePnL.pnlA > livePnL.pnlB;
  const isResolved = duel.state === 2;
  const isActive = duel.state === 1;

  /**
   * An agent that has never reported has a stored PnL of zero, which the UI drew
   * as "+0.00%" — indistinguishable from an agent that traded and finished flat.
   * That reading cost a real duel: agent A had no process running at all, showed
   * +0.00%, and the forfeit that followed looked arbitrary.
   */
  const Score = ({ bps, reported }: { bps: number; reported: boolean }) => {
    if (!reported) {
      return (
        <div className="text-3xl font-bold tabular-nums text-zinc-600">
          —
          <div className="text-xs font-mono text-zinc-500 mt-1">never reported</div>
        </div>
      );
    }
    return (
      <div className={`text-3xl font-bold tabular-nums ${bps >= 0 ? "text-[#00ff88]" : "text-[#ff3b3b]"}`}>
        {bps >= 0 ? "+" : ""}{(bps / 100).toFixed(2)}%
      </div>
    );
  };

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
            <Score bps={livePnL.pnlA} reported={duel.agentASubmitted} />
            {aWinning && isActive && bothReported && (
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
                <Score bps={livePnL.pnlB} reported={duel.agentBSubmitted} />
                {!aWinning && isActive && bothReported && (
                  <div className="text-xs text-[#00ff88] mt-2">● Leading</div>
                )}
              </>
            )}
          </div>
        </div>

        {/* The race itself. Two numbers say who leads; two curves say how. */}
        <div className="mb-8">
          <DuelChart points={history} labelA="Agent A" labelB="Agent B" />
        </div>

        {/* Agent Chat */}
        <div className="mb-8">
          <AgentChat duelId={duelId} isActive={isActive} />
        </div>

        {/* Settlement — the stretch between the final whistle and the payout. A duel
            does not resolve itself; without this the stakes just sit there. */}
        {isActive && settlement && now >= endTime && (
          <div className="mb-8">
            <SettlementPanel
              duelId={duelId}
              stake={duel.stake}
              settlement={settlement}
              now={now}
              onResolved={refresh}
            />
          </div>
        )}

        {/* Resolution Banner — a duel has three possible endings and only one of
            them has a winner. A no-contest used to render nothing at all, so the
            page said "Resolved" and left you to guess what had happened to the
            stakes. */}
        {isResolved && (() => {
          // Four ways a duel ends, and the page should name the right one.
          // Competing means reporting live PnL; settling is the encrypted final.
          const aCompeted = duel.agentASubmitted;
          const bCompeted = duel.agentBSubmitted;
          const byForfeit = aCompeted !== bCompeted;
          const bothSettled = !!settlement?.agentASettled && !!settlement?.agentBSettled;
          const onPublicScores = aCompeted && bCompeted && !bothSettled;
          const hasWinner = duel.winner && duel.winner !== ethers.ZeroAddress;

          if (!hasWinner) {
            return (
              <div className="border border-zinc-700 rounded-lg p-6 mb-8">
                <div className="text-xs text-zinc-400 mb-2">NO CONTEST</div>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🤝</span>
                  <div>
                    <div className="font-bold text-lg">Both stakes refunded in full</div>
                    <div className="text-xs font-mono text-zinc-500 mt-1">
                      Neither agent reported anything, so there was nothing to compare. No
                      winner, no protocol fee — {ethers.formatEther(duel.stake)} COTI back to
                      each side.
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div className="border border-[#00ff88] rounded-lg p-6 mb-8">
              <div className="text-xs text-[#00ff88] mb-2">DUEL RESOLVED</div>
              <div className="flex items-center gap-3">
                <span className="text-2xl">🏆</span>
                <div>
                  <div className="font-bold text-lg">
                    {byForfeit ? "Winner by forfeit" : "Winner"}
                  </div>
                  <div className="font-mono text-zinc-400">{duel.winner}</div>
                  <div className="text-xs font-mono text-zinc-500 mt-1">
                    {byForfeit
                      ? "The other agent never reported a score, so it did not compete."
                      : onPublicScores
                        ? "Decided on the public scores — one side did not submit an encrypted final, so there was nothing to compare inside the circuit."
                        : "Decided by a garbled-circuit comparison of the two encrypted scores."}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* What is private here, in one line rather than a manifesto. */}
        <div className="p-4 border border-zinc-800 rounded-lg bg-zinc-950">
          <p className="text-xs text-zinc-600 font-mono leading-relaxed">
            🔒 Your strategy is yours: positions, allocations and the logic behind them run
            off-chain and never touch the blockchain. What you see above is the one number each
            agent publishes — its total return — which is the part worth watching.
          </p>
        </div>
      </div>
    </main>
  );
}
