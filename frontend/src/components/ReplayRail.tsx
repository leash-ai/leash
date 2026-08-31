"use client";

/**
 * Finished duels, as something to browse rather than a list to read.
 *
 * A finished duel is not dead weight here: the whole curve is rebuilt from the
 * chain, so any of these can be watched back in full. That makes them the
 * closest thing this product has to a catalogue — and a catalogue is browsed
 * sideways, past a lot of it, not scrolled through one row at a time.
 *
 * Each card is a result, not a summary: who raced, what they finished at, and
 * who took it. The margin is the number a spectator wants, so it is the one set
 * large.
 */
import Link from "next/link";
import { BoardDuel } from "@/hooks/useDuelBoard";

const pct = (bps: number | null) =>
  bps === null ? "—" : `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;

export function ReplayRail({
  duels,
  nameFor,
}: {
  duels: BoardDuel[];
  /** Turns an address into whatever the page knows to call it. */
  nameFor: (duel: BoardDuel, side: "a" | "b") => string;
}) {
  if (duels.length === 0) {
    return (
      <div className="border border-track-line rounded-lg bg-track-soft px-6 py-10 text-center">
        <p className="text-sm text-ink-faint">
          No duels have finished yet. The first one to run will be here to watch back.
        </p>
      </div>
    );
  }

  return (
    // Scroll snapping, so a flick lands on a card rather than between two.
    <div className="flex gap-4 overflow-x-auto pb-3 -mx-6 px-6 snap-x snap-mandatory">
      {duels.map((duel) => {
        const aWon = duel.winner.toLowerCase() === duel.agentA.toLowerCase();
        const bWon = duel.winner.toLowerCase() === duel.agentB.toLowerCase();
        const noContest = !aWon && !bWon;
        const margin =
          duel.pnlA !== null && duel.pnlB !== null ? Math.abs(duel.pnlA - duel.pnlB) : null;
        const ran = Number(duel.endTime) - Number(duel.startTime);

        return (
          <Link
            key={duel.id}
            href={`/duel/${duel.id}`}
            className="group shrink-0 w-64 snap-start border border-track-line rounded-lg bg-track-soft p-4 hover:border-track-edge transition-colors"
          >
            <div className="flex items-baseline justify-between mb-3.5">
              <span className="font-mono text-xs tnum text-ink-faint">#{duel.id}</span>
              <span className="text-[10px] font-display tracking-board uppercase text-ink-faint group-hover:text-best transition-colors">
                Watch back
              </span>
            </div>

            <Finish name={nameFor(duel, "a")} score={pct(duel.pnlA)} won={aWon} lane="a" />
            <Finish name={nameFor(duel, "b")} score={pct(duel.pnlB)} won={bWon} lane="b" />

            <div className="flex items-baseline justify-between mt-3.5 pt-3 border-t border-track-line">
              <span className="text-[10px] font-display tracking-board uppercase text-ink-faint">
                {noContest ? "No contest" : "Margin"}
              </span>
              <span className="font-mono text-sm tnum text-ink">
                {noContest || margin === null ? "—" : `${(margin / 100).toFixed(2)}%`}
              </span>
            </div>

            <div className="mt-1 text-[10px] font-mono text-ink-faint tnum">
              {Math.max(0, Math.round(ran / 60))} min
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/** One entrant's finishing line. The winner is the only one in full contrast. */
function Finish({
  name,
  score,
  won,
  lane,
}: {
  name: string;
  score: string;
  won: boolean;
  lane: "a" | "b";
}) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span
        className={`w-1 h-5 rounded-full shrink-0 ${lane === "a" ? "bg-lane-a" : "bg-lane-b"} ${
          won ? "" : "opacity-40"
        }`}
      />
      <span className={`flex-1 truncate text-sm ${won ? "text-ink" : "text-ink-faint"}`}>
        {name}
      </span>
      <span className={`font-mono text-xs tnum ${won ? "text-best" : "text-ink-faint"}`}>
        {score}
      </span>
    </div>
  );
}
