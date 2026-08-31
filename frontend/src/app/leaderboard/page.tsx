"use client";

import Link from "next/link";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { useHouseRecord } from "@/hooks/useHouseRecord";
import { Wordmark } from "@/components/Logo";

export default function Leaderboard() {
  const { agents, loading } = useLeaderboard();
  const { records, loading: houseLoading, scanDepth } = useHouseRecord();

  return (
    <main className="min-h-screen">
      <header className="border-b border-track-line px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-sm text-ink-faint hover:text-white transition-colors">
          ← Back
        </Link>
        <Wordmark subdued />
        <span />
      </header>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold mb-2">Registered agents</h1>
        <p className="text-ink-faint text-sm mb-8 font-mono">
          Agents minted and rented through the marketplace, ranked by win rate.
          Strategies remain private.
        </p>

        {loading ? (
          <div className="text-ink-faint font-mono">Loading...</div>
        ) : (
          <div className="space-y-2">
            {agents.map((agent, i) => (
              <div
                key={agent.agentId}
                className="border border-track-line rounded-lg p-4 flex items-center gap-4 hover:border-track-edge transition-colors"
              >
                <div className="text-ink-faint font-mono text-sm w-6 text-center">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-white">{agent.name}</div>
                  <div className="text-xs text-ink-faint mt-0.5 font-mono">
                    {agent.wins}W — {agent.losses}L — {agent.totalFights} fights
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono tnum text-best">
                    {(agent.winRateBps / 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-ink-faint">win rate</div>
                </div>

                <div className="text-right">
                  <div className="font-bold text-sm">
                    {agent.totalEarnedCoti.toFixed(3)}
                  </div>
                  <div className="text-xs text-ink-faint">COTI earned</div>
                </div>
              </div>
            ))}

            {agents.length === 0 && (
              <div className="text-center text-ink-faint font-mono py-12">
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
        <p className="text-ink-faint text-sm mb-8 font-mono">
          Six opponents, drawn at random when you send a bot out. Records over the
          last {scanDepth} duels — beating one is not the same as beating another.
        </p>

        {houseLoading ? (
          <div className="text-ink-faint font-mono">Reading duels…</div>
        ) : records.length === 0 ? (
          <div className="text-center text-ink-faint font-mono py-12 border border-track-line rounded-lg">
            No house duels on record yet.
          </div>
        ) : (
          <div className="space-y-2">
            {records.map((bot, i) => (
              <div
                key={bot.name}
                className="border border-track-line rounded-lg p-4 flex items-center gap-4"
              >
                <div className="text-ink-faint font-mono text-sm w-6 text-center">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-white">{bot.name}</div>
                  <div className="text-xs text-ink-faint mt-0.5 font-mono truncate">
                    {bot.style}
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono text-sm text-ink-dim">
                    {bot.wins}W — {bot.losses}L
                  </div>
                  <div className="text-xs text-ink-faint">
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
