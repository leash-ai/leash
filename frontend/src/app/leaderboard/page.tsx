"use client";

import Link from "next/link";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { useHouseRecord } from "@/hooks/useHouseRecord";

export default function Leaderboard() {
  const { agents, loading } = useLeaderboard();
  const { records, loading: houseLoading, scanDepth } = useHouseRecord();

  return (
    <main className="min-h-screen">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-sm text-zinc-500 hover:text-white transition-colors">
          ← Back
        </Link>
        <span className="font-bold tracking-tight">LEADERBOARD</span>
        <span />
      </header>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold mb-2">Registered agents</h1>
        <p className="text-zinc-500 text-sm mb-8 font-mono">
          Agents minted and rented through the marketplace, ranked by win rate.
          Strategies remain private.
        </p>

        {loading ? (
          <div className="text-zinc-600 font-mono">Loading...</div>
        ) : (
          <div className="space-y-2">
            {agents.map((agent, i) => (
              <div
                key={agent.agentId}
                className="border border-zinc-800 rounded-lg p-4 flex items-center gap-4 hover:border-zinc-600 transition-colors"
              >
                <div className="text-zinc-600 font-mono text-sm w-6 text-center">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-white">{agent.name}</div>
                  <div className="text-xs text-zinc-600 mt-0.5 font-mono">
                    {agent.wins}W — {agent.losses}L — {agent.totalFights} fights
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[#00ff88] font-bold">
                    {(agent.winRateBps / 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-zinc-600">win rate</div>
                </div>

                <div className="text-right">
                  <div className="font-bold text-sm">
                    {agent.totalEarnedCoti.toFixed(3)}
                  </div>
                  <div className="text-xs text-zinc-600">COTI earned</div>
                </div>
              </div>
            ))}

            {agents.length === 0 && (
              <div className="text-center text-zinc-600 font-mono py-12">
                No agents registered yet.
              </div>
            )}
          </div>
        )}

        {/*
          The table above ranks marketplace NFTs. The bots people actually race
          are not in it, so on its own the page ranked a cast the product no
          longer puts on screen.
        */}
        <h2 className="text-2xl font-bold mb-2 mt-16">The house</h2>
        <p className="text-zinc-500 text-sm mb-8 font-mono">
          Six opponents, drawn at random when you send a bot out. Records over the
          last {scanDepth} duels — beating one is not the same as beating another.
        </p>

        {houseLoading ? (
          <div className="text-zinc-600 font-mono">Reading duels…</div>
        ) : records.length === 0 ? (
          <div className="text-center text-zinc-600 font-mono py-12 border border-zinc-800 rounded-lg">
            No house duels on record yet.
          </div>
        ) : (
          <div className="space-y-2">
            {records.map((bot, i) => (
              <div
                key={bot.name}
                className="border border-zinc-800 rounded-lg p-4 flex items-center gap-4"
              >
                <div className="text-zinc-600 font-mono text-sm w-6 text-center">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-white">{bot.name}</div>
                  <div className="text-xs text-zinc-600 mt-0.5 font-mono truncate">
                    {bot.style}
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono text-sm text-zinc-300">
                    {bot.wins}W — {bot.losses}L
                  </div>
                  <div className="text-xs text-zinc-600">
                    {bot.fights === 0 ? "not drawn yet" : `${bot.fights} duels`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
