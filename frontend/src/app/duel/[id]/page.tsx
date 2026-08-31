"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useDuel } from "@/hooks/useDuel";
import { AgentChat } from "@/components/AgentChat";
import { SettlementPanel } from "@/components/SettlementPanel";
import { DuelChart } from "@/components/DuelChart";
import { useDuelHistory } from "@/hooks/useDuelHistory";
import { useLiveMarks } from "@/hooks/useLiveMarks";
import { Wordmark } from "@/components/Logo";
import { TimingStrip } from "@/components/TimingStrip";
import { useMyBots } from "@/hooks/useMyBots";
import { opponentFor } from "@/lib/houseRoster";
import { ethers } from "ethers";

/** Set this and the house side of a duel is named rather than left as an address. */
const HOUSE_ADDRESS = process.env.NEXT_PUBLIC_HOUSE_BOT_ADDRESS?.toLowerCase() ?? null;

// DuelState enum: Open=0, Active=1, Resolved=2
const STATE_LABELS = ["Open", "Active", "Resolved"];
const STATE_COLORS = ["text-yellow-400", "text-green-400", "text-ink-dim"];

export default function DuelPage() {
  const { id } = useParams();
  const duelId = Number(id);
  const { duel, livePnL, settlement, loading, refresh } = useDuel(duelId);
  const { bots } = useMyBots();
  const [now, setNow] = useState(Date.now());
  // Re-read the curve on the same cadence the duel data uses. It was 15s, which
  // is slower than the agents publish — the curve gained points in bursts and
  // sat still between them.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(t);
  }, []);
  const history = useDuelHistory(
    duelId,
    duel?.agentA,
    duel?.agentB,
    duel ? Number(duel.startTime) : undefined,
    tick,
  );

  /*
    The chain is the record; the feed is the animation.

    Batches land every few seconds carrying sub-second points, so the history
    already has the real shape — but it arrives in bursts. The agents also mark
    four times a second over the feed, which is what moves the line between
    batches. Seeded from the chain so opening mid-duel still shows the whole
    race, and the chain's version is what remains once the feed is gone.
  */
  const live = useLiveMarks(duelId, history, duel ? Number(duel.startTime) : undefined);
  const curve = live.length > history.length ? live : history;

  /*
    One number per side on the page, not two.

    The panels read getLivePnL from the chain while the chart drew the feed, so
    the same score appeared twice with different values — the chain lags by a
    batch, and two disagreeing figures on one screen is the fastest way to make
    real data look invented. Both read the curve now, with the chain as the
    fallback when there is no feed, which is also what settles.
  */
  const latest = curve[curve.length - 1];
  const shownA = latest?.a ?? livePnL.pnlA;
  const shownB = latest?.b ?? livePnL.pnlB;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-ink-faint font-mono">Loading duel #{duelId}...</div>
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
  const isResolved = duel.state === 2;
  const isActive = duel.state === 1;

  /**
   * An agent that has never reported has a stored PnL of zero, which the UI drew
   * as "+0.00%" — indistinguishable from an agent that traded and finished flat.
   * That reading cost a real duel: agent A had no process running at all, showed
   * +0.00%, and the forfeit that followed looked arbitrary.
   */
  /**
   * Who each address is.
   *
   * Two addresses side by side say nothing about a match you are meant to watch.
   * The house side is derivable — the bot that played picked itself from
   * (duelId, startTime), so the same draw is recomputed here rather than stored
   * anywhere. Your side comes from the bot you sent, which this browser
   * remembers. Anything else stays an address, which is the honest answer.
   */
  const house = opponentFor(duelId, Number(duel.startTime));

  const identify = (address: string, fallback: string) => {
    if (HOUSE_ADDRESS && address.toLowerCase() === HOUSE_ADDRESS && house) {
      return { label: "HOUSE BOT", name: house.name, note: house.style };
    }
    const mine = bots.find((b) => b.duelIds.includes(duelId));
    if (mine && address.toLowerCase() === duel.agentA.toLowerCase()) {
      return { label: "YOUR BOT", name: mine.name, note: "built by you" };
    }
    // Nothing names this one, so the address is the name. Repeating the generic
    // header as a title would just look like the page failed to load something.
    return { label: fallback, name: address, note: null };
  };


  /** Shaped for the timing strip, from the same identification. */
  const identifyEntrant = (address: string, fallback: string) => {
    const who = identify(address, fallback);
    return { role: who.label, label: who.name, detail: who.note };
  };

  /** The curves carry the same names as the panels above them. */
  const chartLabel = (address: string, fallback: string) => {
    if (address === ethers.ZeroAddress) return fallback;
    const who = identify(address, fallback);
    return who.note ? who.name : fallback;
  };


  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-track-line px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-sm text-ink-faint hover:text-ink transition-colors">
          ← Back
        </Link>
        <Wordmark />
        <span className={`text-[11px] font-display tracking-board uppercase ${STATE_COLORS[duel.state] ?? "text-ink-faint"}`}>
          {STATE_LABELS[duel.state] ?? "Unknown"}
        </span>
      </header>

      <div className="flex-1 px-6 py-8 max-w-5xl mx-auto w-full">
        <div className="flex items-baseline justify-between mb-5">
          <h1 className="font-display text-2xl tracking-wide">
            <span className="text-ink-faint">DUEL</span> <span className="tnum">#{duelId}</span>
          </h1>
        </div>

        {/*
          The scoreboard as a trackside timing strip — see TimingStrip.

          It replaced three equal boxes where the prize pool was set at the same
          weight as the two scores, which said the stake mattered as much as who
          was winning. Position, entrant, return, gap: every column answers a
          question the page already had, in an order the reader knows.
        */}
        <div className="mb-8">
          <TimingStrip
            a={{
              ...identifyEntrant(duel.agentA, "AGENT A"),
              bps: duel.agentASubmitted ? shownA : null,
              lane: "a",
            }}
            b={
              duel.agentB === ethers.ZeroAddress
                ? { role: "OPPONENT", label: "Waiting for a challenger", detail: null, bps: null, lane: "b" }
                : {
                    ...identifyEntrant(duel.agentB, "AGENT B"),
                    bps: duel.agentBSubmitted ? shownB : null,
                    lane: "b",
                  }
            }
            prizeCoti={prize}
            clock={
              isActive && remaining > 0 ? (
                <span className="font-mono text-sm tnum text-ink-dim">
                  {minutes.toString().padStart(2, "0")}:
                  {seconds.toString().padStart(2, "0")}
                  <span className="text-ink-faint ml-1.5">left</span>
                </span>
              ) : null
            }
          />
        </div>


        <div className="mb-8">
          <DuelChart
            points={curve}
            labelA={chartLabel(duel.agentA, "Agent A")}
            labelB={chartLabel(duel.agentB, "Agent B")}
          />
        </div>

        {/*
          The feed, only while there is one.

          Before a duel starts it showed an empty box saying "define your
          strategy before the duel starts" over a text field — but the strategy
          came from the bot you built, and typing here changed nothing. An input
          that does nothing is worse than no input: it implies a step you have
          already taken and leaves you wondering whether you missed it.
        */}
        {(isActive || isResolved) && (
          <div className="mb-8">
            <AgentChat duelId={duelId} isActive={isActive} />
          </div>
        )}

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
              <div className="border border-track-edge rounded-lg p-6 mb-8">
                <div className="text-xs text-ink-dim mb-2">NO CONTEST</div>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🤝</span>
                  <div>
                    <div className="font-bold text-lg">Both stakes refunded in full</div>
                    <div className="text-xs font-mono text-ink-faint mt-1">
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
            <div className="border border-best/40 bg-best/[0.04] rounded-lg p-6 mb-8">
              <div className="text-[10px] font-display tracking-board text-best mb-2">DUEL RESOLVED</div>
              <div className="flex items-center gap-3">
                <span className="text-2xl">🏆</span>
                <div>
                  <div className="font-bold text-lg">
                    {byForfeit ? "Winner by forfeit" : "Winner"}
                  </div>
                  <div className="font-mono text-ink-dim">{duel.winner}</div>
                  <div className="text-xs font-mono text-ink-faint mt-1">
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

        {/*
          Two things the page used to leave you to work out: what the numbers
          mean, and what happens when the clock hits zero. The reveal button is
          gone on purpose, and without a word about it the countdown just runs
          out and nothing visibly happens.
        */}
        <div className="p-4 border border-track-line rounded-lg bg-track-soft space-y-3">
          <p className="text-xs text-ink-faint font-mono leading-relaxed">
            🔒 Your strategy is yours: positions, allocations and the logic behind them run
            off-chain and never touch the blockchain. What you see above is the one number each
            agent publishes — its total return — which is the part worth watching.
          </p>
          <p className="text-xs text-ink-faint font-mono leading-relaxed">
            📈 Scored on a notional position — the trades each agent actually makes, sized
            as if it were running 100× its capital. Ten minutes of spot crypto separates two
            agents by hundredths of a percent, which is a real result and an unwatchable one.
            Both sides are scored the same way, so it changes the margin, never the winner.
            Your stake is the stake; nothing here is borrowed and nobody is liquidated.
          </p>
          <p className="text-xs text-ink-faint font-mono leading-relaxed">
            {isResolved
              ? "Settled. Each agent submitted its final score encrypted, a garbled circuit compared the two without decrypting either, and only the winner came out."
              : "When the clock runs out, live reporting closes and each agent submits its final score encrypted, pinned to the last figure it published. A garbled circuit then compares the two and pays the winner — automatically, with nothing for you to press."}
          </p>
        </div>
      </div>
    </main>
  );
}
