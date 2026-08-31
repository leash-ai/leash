"use client";

import { useState } from "react";
import Link from "next/link";
import { CreateDuelModal } from "@/components/CreateDuelModal";
import { LiveDuelList } from "@/components/LiveDuelList";
import { WalletButton } from "@/components/WalletButton";
import { useStats } from "@/hooks/useStats";
import { Wordmark } from "@/components/Logo";

export default function Home() {
  const [showCreate, setShowCreate] = useState(false);
  const { stats } = useStats();

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wordmark />
          <span className="text-xs text-zinc-500 border border-zinc-700 px-2 py-0.5 rounded">
            COTI Testnet
          </span>
        </div>
        <nav className="flex items-center gap-6">
          <Link href="/bots" className="text-sm text-zinc-400 hover:text-white transition-colors">
            My bots
          </Link>
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

      {/*
        The page used to open with "My agent vs your agent" and a button reading
        "Challenge someone". There is nobody to challenge: the house takes every
        duel, instantly, and always has. Selling a player-versus-player product
        that does not exist is the first thing a visitor finds out is untrue.
      */}
      <section className="px-6 py-16 text-center border-b border-zinc-800">
        <h1 className="text-5xl font-bold tracking-tight mb-4">
          Build a bot.<br />
          <span className="text-[#00ff88]">Race the house.</span>
        </h1>
        <p className="text-zinc-400 text-lg max-w-lg mx-auto mb-8">
          Describe how you want to trade and the AI writes the strategy. One of
          six house bots takes your challenge the moment you make it — which one
          is random. Two returns, one clock, the better one takes the pot.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/bots"
            className="bg-[#00ff88] text-black font-bold px-8 py-3 rounded-lg text-lg hover:bg-[#00cc6a] transition-colors"
          >
            Build your bot
          </Link>
          <Link
            href="#live"
            className="border border-zinc-700 text-zinc-300 font-medium px-8 py-3 rounded-lg text-lg hover:border-zinc-500 transition-colors"
          >
            Watch a duel
          </Link>
        </div>
        <p className="text-zinc-600 text-xs font-mono mt-4">
          0.1 COTI a duel, same both sides · 2 min, 10 min or an hour
        </p>

        {/* Stats bar */}
        <div className="flex items-center justify-center gap-12 mt-12 text-sm">
          <div>
            <div className="text-2xl font-bold text-white">
              {stats ? stats.totalDuels : "—"}
            </div>
            <div className="text-zinc-500">Duels run</div>
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
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            {
              step: "01",
              title: "Build your bot",
              desc: "Describe how it should trade in a sentence. The AI writes the strategy; the bot is yours and goes into as many duels as you like.",
            },
            {
              step: "02",
              title: "The house takes it",
              desc: "Six opponents, each playing differently. Which one you draw is decided when it joins, so there is nothing to tune against.",
            },
            {
              step: "03",
              title: "Watch it run",
              desc: "Both returns move side by side until the clock stops. Positions stay off-chain — your strategy never leaves your machine.",
            },
            {
              step: "04",
              title: "Settled under encryption",
              desc: "Each agent submits its final score encrypted. A garbled circuit compares them without decrypting either, and pays the winner. Nothing to press.",
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
