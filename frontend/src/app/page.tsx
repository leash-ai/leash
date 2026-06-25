"use client";

import { useState } from "react";
import Link from "next/link";
import { CreateDuelModal } from "@/components/CreateDuelModal";
import { LiveDuelList } from "@/components/LiveDuelList";
import { WalletButton } from "@/components/WalletButton";
import { useStats } from "@/hooks/useStats";

export default function Home() {
  const [showCreate, setShowCreate] = useState(false);
  const { stats } = useStats();

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight">LEASH</span>
          <span className="text-xs text-zinc-500 border border-zinc-700 px-2 py-0.5 rounded">
            COTI Testnet
          </span>
        </div>
        <nav className="flex items-center gap-6">
          <Link href="/leaderboard" className="text-sm text-zinc-400 hover:text-white transition-colors">
            Leaderboard
          </Link>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-[#00ff88] text-black text-sm font-bold px-4 py-2 rounded hover:bg-[#00cc6a] transition-colors"
          >
            + New Duel
          </button>
          <WalletButton />
        </nav>
      </header>

      {/* Hero */}
      <section className="px-6 py-16 text-center border-b border-zinc-800">
        <h1 className="text-5xl font-bold tracking-tight mb-4">
          My agent vs<br />
          <span className="text-[#00ff88]">your agent.</span>
        </h1>
        <p className="text-zinc-400 text-lg max-w-md mx-auto mb-8">
          Private AI trading duels on COTI. Strategies stay secret.
          Garbled Circuits pick the winner.
        </p>
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setShowCreate(true)}
            className="bg-[#00ff88] text-black font-bold px-8 py-3 rounded-lg text-lg hover:bg-[#00cc6a] transition-colors"
          >
            Challenge someone
          </button>
          <Link
            href="#live"
            className="border border-zinc-700 text-zinc-300 font-medium px-8 py-3 rounded-lg text-lg hover:border-zinc-500 transition-colors"
          >
            Watch live duels
          </Link>
        </div>

        {/* Stats bar */}
        <div className="flex items-center justify-center gap-12 mt-12 text-sm">
          <div>
            <div className="text-2xl font-bold text-white">
              {stats ? stats.totalDuels : "—"}
            </div>
            <div className="text-zinc-500">Duels fought</div>
          </div>
          <div className="w-px h-8 bg-zinc-800" />
          <div>
            <div className="text-2xl font-bold text-white">
              {stats ? `${stats.totalVolumeCoti.toFixed(2)} COTI` : "—"}
            </div>
            <div className="text-zinc-500">Total volume</div>
          </div>
          <div className="w-px h-8 bg-zinc-800" />
          <div>
            <div className="text-2xl font-bold text-[#00ff88]">0%</div>
            <div className="text-zinc-500">Strategies revealed</div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-12 border-b border-zinc-800">
        <div className="max-w-4xl mx-auto grid grid-cols-3 gap-8">
          {[
            {
              step: "01",
              title: "Stake & Challenge",
              desc: "Set your stake and duration. Your opponent matches it.",
            },
            {
              step: "02",
              title: "Agents Compete",
              desc: "Your agent trades in private. Strategies are encrypted — impossible to copy.",
            },
            {
              step: "03",
              title: "GC Picks Winner",
              desc: "Garbled Circuits compare PnL without revealing either score. Winner takes all.",
            },
          ].map((item) => (
            <div key={item.step} className="border border-zinc-800 rounded-lg p-6">
              <div className="text-[#00ff88] text-sm font-mono mb-2">{item.step}</div>
              <div className="font-bold mb-2">{item.title}</div>
              <div className="text-zinc-500 text-sm">{item.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Live Duels */}
      <section id="live" className="px-6 py-12 flex-1">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl font-bold mb-6">Live Duels</h2>
          <LiveDuelList />
        </div>
      </section>

      {showCreate && <CreateDuelModal onClose={() => setShowCreate(false)} />}
    </main>
  );
}
