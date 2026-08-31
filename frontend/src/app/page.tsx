"use client";

import { useState } from "react";
import Link from "next/link";
import { CreateDuelModal } from "@/components/CreateDuelModal";
import { LiveDuelList } from "@/components/LiveDuelList";
import { ReplayRail } from "@/components/ReplayRail";
import { useDuelBoard, BoardDuel } from "@/hooks/useDuelBoard";
import { opponentFor } from "@/lib/houseRoster";
import { WalletButton } from "@/components/WalletButton";
import { useStats } from "@/hooks/useStats";
import { Wordmark } from "@/components/Logo";

const HOUSE_ADDRESS = process.env.NEXT_PUBLIC_HOUSE_BOT_ADDRESS?.toLowerCase() ?? null;

export default function Home() {
  const [showCreate, setShowCreate] = useState(false);
  const { stats } = useStats();
  const { live, finished } = useDuelBoard();

  /*
    The house side is derivable from the chain, so a replay names its opponent
    rather than showing a wallet. Yours stays an address here: the bot that
    played is remembered by the browser that sent it, and a replay is something
    anyone can open.
  */
  const nameFor = (duel: BoardDuel, side: "a" | "b") => {
    const address = side === "a" ? duel.agentA : duel.agentB;
    if (HOUSE_ADDRESS && address.toLowerCase() === HOUSE_ADDRESS) {
      const bot = opponentFor(duel.id, Number(duel.startTime));
      if (bot) return bot.name;
    }
    return `${address.slice(0, 8)}…`;
  };

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-track-line px-6 py-4 flex items-center justify-between">
        <Wordmark />
        {/*
          Navigation and the wallet, nothing else.

          The network badge stated a fact nobody was deciding anything with, and
          "+ New Duel" was the hero's own button repeated three inches above it —
          two controls doing one job, so the eye has to work out whether they
          differ. They do not.
        */}
        <nav className="flex items-center gap-6">
          <Link href="/bots" className="text-sm text-ink-dim hover:text-ink transition-colors">
            My bots
          </Link>
          <Link href="/leaderboard" className="text-sm text-ink-dim hover:text-ink transition-colors">
            Leaderboard
          </Link>
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
            Build a bot
          </Link>
          {/*
            "Watch a duel" scrolled to a list that is empty on a quiet minute —
            a button whose only promise is that something might be happening.
            Launching one is the action the page is for, and it always works.
          */}
          <button
            onClick={() => setShowCreate(true)}
            className="border border-track-edge text-ink-dim font-display text-lg tracking-wide px-8 py-3.5 rounded-md hover:border-ink-faint hover:text-ink transition-colors"
          >
            Launch a duel
          </button>
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

      {/*
        The board: what is running, then what has run.

        Only live duels were listed, so on a quiet minute the page ended in an
        empty box — a product with nothing happening in it. Finished duels are
        the other half and they are not dead weight: the whole curve is rebuilt
        from the chain, so any of them can be watched back. They browse sideways,
        the way a catalogue does, rather than adding rows to scroll past.
      */}
      <section id="live" className="px-6 py-12 flex-1 border-b border-track-line/60">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-baseline gap-3 mb-5">
            <h2 className="font-display text-xl tracking-board uppercase text-ink-dim">
              Running now
            </h2>
            {live.length > 0 && (
              <span className="flex items-center gap-1.5 text-[10px] font-display tracking-board uppercase text-gain">
                <span className="w-1.5 h-1.5 rounded-full bg-gain animate-pulse" />
                {live.length}
              </span>
            )}
          </div>
          <LiveDuelList />
        </div>
      </section>

      <section className="px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-baseline justify-between gap-3 mb-5">
            <h2 className="font-display text-xl tracking-board uppercase text-ink-dim">
              Replays
            </h2>
            <span className="text-[11px] text-ink-faint">
              Every finished duel, replayed from the chain
            </span>
          </div>
          <ReplayRail duels={finished} nameFor={nameFor} />
        </div>
      </section>

      {showCreate && <CreateDuelModal onClose={() => setShowCreate(false)} />}
    </main>
  );
}
