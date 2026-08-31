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
      <header className="border-b border-track-line px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wordmark />
          <span className="text-xs text-ink-faint border border-track-edge px-2 py-0.5 rounded">
            COTI Testnet
          </span>
        </div>
        <nav className="flex items-center gap-6">
          <Link href="/bots" className="text-sm text-ink-dim hover:text-white transition-colors">
            My bots
          </Link>
          <Link href="/leaderboard" className="text-sm text-ink-dim hover:text-white transition-colors">
            Leaderboard
          </Link>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-best text-track text-sm font-display tracking-wide px-4 py-2 rounded hover:brightness-110 transition-all"
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
      <section className="px-6 py-16 text-center border-b border-track-line">
        {/*
          Set in the condensed display face, which is what a timing board uses
          because narrow letters fit a name in a column. The accent is the
          session-best purple, not green: in this palette green means "improving
          on itself" and is doing a job on every chart — a brand colour that also
          means something is a colour that means nothing.
        */}
        <h1 className="font-display text-6xl md:text-7xl leading-[0.95] tracking-tight mb-5">
          BUILD A BOT.<br />
          <span className="text-best">RACE THE HOUSE.</span>
        </h1>
        <p className="text-ink-dim text-lg max-w-lg mx-auto mb-8">
          Describe how you want to trade and the AI writes the strategy. One of
          six house bots takes your challenge the moment you make it — which one
          is random. Two returns, one clock, the better one takes the pot.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/bots"
            className="bg-best text-track font-display text-lg tracking-wide px-8 py-3.5 rounded-md hover:brightness-110 transition-all"
          >
            Build your bot
          </Link>
          <Link
            href="#live"
            className="border border-track-edge text-ink-dim font-display text-lg tracking-wide px-8 py-3.5 rounded-md hover:border-ink-faint hover:text-ink transition-colors"
          >
            Watch a duel
          </Link>
        </div>
        <p className="text-ink-faint text-xs font-mono mt-4">
          0.1 COTI a duel, same both sides · 2 min, 10 min or an hour
        </p>

        {/* Stats bar */}
        <div className="flex items-center justify-center gap-12 mt-12 text-sm">
          <div>
            <div className="font-mono text-2xl tnum text-ink">
              {stats ? stats.totalDuels : "—"}
            </div>
            <div className="text-ink-faint">Duels run</div>
          </div>
          <div className="w-px h-8 bg-zinc-800" />
          <div>
            <div className="font-mono text-2xl tnum text-ink">
              {stats ? `${stats.totalVolumeCoti.toFixed(2)} COTI` : "—"}
            </div>
            <div className="text-ink-faint">Total volume</div>
          </div>
          <div className="w-px h-8 bg-zinc-800" />
          <div>
            <div className="font-mono text-2xl tnum text-best">0%</div>
            <div className="text-ink-faint">Strategies revealed</div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-12 border-b border-track-line">
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
            <div key={item.step} className="border border-track-line rounded-lg p-6">
              <div className="font-mono text-xs tnum text-ink-faint mb-3">{item.step}</div>
              <div className="font-display text-lg tracking-wide mb-2">{item.title}</div>
              <div className="text-ink-faint text-sm">{item.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Live Duels */}
      <section id="live" className="px-6 py-12 flex-1">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-display text-xl tracking-board uppercase text-ink-dim mb-5">Live Duels</h2>
          <LiveDuelList />
        </div>
      </section>

      {showCreate && <CreateDuelModal onClose={() => setShowCreate(false)} />}
    </main>
  );
}
