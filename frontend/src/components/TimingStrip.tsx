/**
 * The scoreboard, read as a trackside timing screen.
 *
 * A duel is two entrants, one clock, a gap and a leader. That is a race, and
 * races have had a precise visual language for decades: a position column, the
 * entrant with its livery, the number that matters set large and monospaced, and
 * the gap to the car ahead. Borrowing it is not decoration — every column here
 * answers a question the page already had to answer, and the reader knows the
 * conventions before arriving.
 *
 * It replaces three equal boxes with the prize pool given the same weight as the
 * scores, which said the stake mattered as much as who was winning.
 */
import { ReactNode } from "react";

export interface Entrant {
  label: string;
  /** What kind of entrant: shown small above the name. */
  role: string;
  detail?: string | null;
  /** Score in basis points, or null when it has never reported. */
  bps: number | null;
  lane: "a" | "b";
}

const LANE = {
  a: { color: "#22D3EE", bar: "bg-lane-a" },
  b: { color: "#F472B6", bar: "bg-lane-b" },
} as const;

const pct = (bps: number | null) =>
  bps === null ? "—" : `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;

export function TimingStrip({
  a,
  b,
  prizeCoti,
  clock,
}: {
  a: Entrant;
  b: Entrant;
  prizeCoti: number;
  /** Whatever belongs where a race would put its clock. */
  clock?: ReactNode;
}) {
  const leader = a.bps === null || b.bps === null ? null : a.bps > b.bps ? "a" : a.bps < b.bps ? "b" : null;
  const gap = a.bps !== null && b.bps !== null ? Math.abs(a.bps - b.bps) : null;

  return (
    <div className="border border-track-line rounded-lg overflow-hidden bg-track-soft">
      {/* Column headers, the way a timing board labels itself. */}
      <div className="grid grid-cols-[3rem_1fr_7rem] md:grid-cols-[3rem_1fr_8rem_9rem] gap-4 px-4 py-2 border-b border-track-line text-[10px] font-display tracking-board text-ink-faint uppercase">
        <span>Pos</span>
        <span>Entrant</span>
        <span className="text-right">Return</span>
        <span className="hidden md:block text-right">Gap</span>
      </div>

      <Row entrant={a} position={leader === "a" ? 1 : leader === null ? null : 2} gap={leader === "b" ? gap : null} />
      <Row entrant={b} position={leader === "b" ? 1 : leader === null ? null : 2} gap={leader === "a" ? gap : null} />

      <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-t border-track-line">
        <span className="text-[10px] font-display tracking-board text-ink-faint uppercase">
          Winner takes
        </span>
        <span className="flex items-baseline gap-4">
          <span className="font-mono text-sm tnum text-ink">{prizeCoti.toFixed(3)} COTI</span>
          {clock}
        </span>
      </div>
    </div>
  );
}

function Row({
  entrant,
  position,
  gap,
}: {
  entrant: Entrant;
  position: number | null;
  gap: number | null;
}) {
  const lane = LANE[entrant.lane];
  const leading = position === 1;

  return (
    <div
      className={`grid grid-cols-[3rem_1fr_7rem] md:grid-cols-[3rem_1fr_8rem_9rem] gap-4 items-center px-4 py-3.5 border-b border-track-line/60 last:border-b-0 ${
        leading ? "bg-white/[0.02]" : ""
      }`}
    >
      <span
        className={`font-display text-lg tnum ${leading ? "text-best" : "text-ink-faint"}`}
      >
        {position ?? "–"}
      </span>

      <span className="flex items-center gap-3 min-w-0">
        {/* The livery stripe. Two entrants, equal weight, told apart by colour
            rather than by which one the brand happens to favour. */}
        <span className={`w-1 h-8 rounded-full shrink-0 ${lane.bar}`} />
        <span className="min-w-0">
          <span className="block text-[10px] font-display tracking-board text-ink-faint uppercase">
            {entrant.role}
          </span>
          <span className="block font-display text-base text-ink truncate">{entrant.label}</span>
          {entrant.detail && (
            <span className="block text-[11px] text-ink-faint truncate">{entrant.detail}</span>
          )}
        </span>
      </span>

      <span
        className="font-mono text-xl tnum text-right"
        style={{ color: entrant.bps === null ? "#5C6472" : lane.color }}
      >
        {pct(entrant.bps)}
      </span>

      <span className="hidden md:block font-mono text-sm tnum text-right text-ink-faint">
        {gap === null ? "" : `−${(gap / 100).toFixed(2)}%`}
      </span>
    </div>
  );
}
