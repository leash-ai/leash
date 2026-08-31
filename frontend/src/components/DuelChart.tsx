"use client";

import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceDot,
} from "recharts";
import { PnlPoint } from "@/hooks/useDuelHistory";

const A_COLOR = "#00ff88";
const B_COLOR = "#5b9dff";

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const pct = (bps: number | null) =>
  bps === null ? "—" : `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;

/**
 * A y range that fits what actually happened.
 *
 * This used to pad to at least ±0.1% on the reasoning that two agents sitting at
 * 0 give recharts a zero-height domain filled with five ticks all reading
 * "0.0%". True, but the floor was doing more than that: a duel separated by
 * 0.03% was drawn inside a 0.23% window, so a real race rendered as two flat
 * lines and the page's promise to let you watch it was empty.
 *
 * The floor only needs to cover the degenerate case. Everything above it fits
 * the data, with zero kept in frame so up and down stay legible at a glance.
 */
const MIN_SPAN_BPS = 2; // 0.02% — enough for recharts to draw distinct ticks

function yDomain(points: PnlPoint[]): [number, number] {
  const vals = points.flatMap((p) => [p.a, p.b]).filter((v): v is number => v !== null);
  if (vals.length === 0) return [-10, 10];
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const pad = Math.max(MIN_SPAN_BPS, (hi - lo) * 0.15);
  return [Math.floor(lo - pad), Math.ceil(hi + pad)];
}

/**
 * The gap, which is the thing you are actually watching.
 *
 * Two curves tell you who is ahead; they do not tell you by how much without
 * reading both axes. On a duel decided by a fraction of a percent that reading
 * is the whole question.
 */
function currentGap(points: PnlPoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const { a, b } = points[i];
    if (a !== null && b !== null) return a - b;
  }
  return null;
}

/**
 * Regular time ticks, whatever the data does.
 *
 * The x axis was categorical, so recharts labelled whichever points happened to
 * exist — and the two agents publish on different cadences, so the labels came
 * out as 0:05, 0:10, 0:40, 0:45, 1:15. Read as a time axis that is nonsense.
 * Treat elapsed seconds as a number and choose round intervals over the span.
 */
function xTicks(points: PnlPoint[]): number[] {
  const last = points[points.length - 1]?.t ?? 0;
  if (last <= 0) return [0];
  const step = [15, 30, 60, 120, 300, 600].find((s) => last / s <= 6) ?? 900;
  const out: number[] = [];
  for (let t = 0; t <= last; t += step) out.push(t);
  return out;
}

/** Two decimals when the swing is small, one when it is not. */
const tickFormat = (span: number) => (v: number) =>
  `${(v / 100).toFixed(span < 100 ? 2 : 1)}%`;

interface Props {
  points: PnlPoint[];
  labelA: string;
  labelB: string;
}

/**
 * The two agents' returns over the duel, side by side.
 *
 * This is the part worth watching: a single pair of numbers tells you who is
 * ahead, a pair of curves tells you how it got that way — who moved first, who
 * gave a lead back, whether it was close all the way.
 */

/** One side of the legend: who, in what colour, at what score. */
function Reading({
  label,
  value,
  color,
  leading,
}: {
  label: string;
  value: number | null;
  color: string;
  leading: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="flex items-center gap-2 text-[11px] font-mono">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-zinc-400 truncate">{label}</span>
        {leading && (
          <span className="text-[9px] tracking-wider text-zinc-600 border border-zinc-800 rounded px-1 py-px shrink-0">
            LEADING
          </span>
        )}
      </span>
      <span className="text-xl font-bold tabular-nums leading-none" style={{ color }}>
        {pct(value)}
      </span>
    </div>
  );
}

export function DuelChart({ points, labelA, labelB }: Props) {
  if (points.length < 2) {
    return (
      <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-6 h-[260px] flex items-center justify-center">
        <span className="text-xs font-mono text-zinc-600">
          {points.length === 0
            ? "No scores reported yet — the curves start on the first tick"
            : "One tick so far, waiting for the next"}
        </span>
      </div>
    );
  }

  const [lo, hi] = yDomain(points);
  const gap = currentGap(points);
  const last = points[points.length - 1];

  return (
    <div className="border border-zinc-800 rounded-xl bg-zinc-950 p-5">
      {/*
        The legend carries each side's current reading.

        A key that only names the colours makes you cross-reference the panels
        above to learn anything, and on a chart that redraws every few seconds
        that is the wrong direction to be looking. Name, colour and number in one
        place; the leader is marked so a crossing is legible without arithmetic.
      */}
      <div className="flex items-end justify-between gap-6 mb-4 px-1">
        <div className="flex items-end gap-7">
          <Reading label={labelA} value={last?.a ?? null} color={A_COLOR} leading={gap !== null && gap > 0} />
          <Reading label={labelB} value={last?.b ?? null} color={B_COLOR} leading={gap !== null && gap < 0} />
        </div>

        {gap !== null && (
          <span className="text-[11px] font-mono text-right shrink-0">
            {gap === 0 ? (
              <span className="text-zinc-500">level — a tie goes to {labelB}</span>
            ) : (
              <>
                <span className="text-zinc-600">gap </span>
                <span className="tabular-nums" style={{ color: gap > 0 ? A_COLOR : B_COLOR }}>
                  {Math.abs(gap / 100).toFixed(2)}%
                </span>
              </>
            )}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={points} margin={{ top: 10, right: 64, bottom: 4, left: -8 }}>
          <defs>
            {/*
              A wash under each line rather than a flat fill.

              Two bare strokes on black read as a diagram; the gradient gives the
              leader visible weight and makes a crossing something you see
              happen. It fades to nothing well before the axis so the two never
              muddy each other where they overlap.
            */}
            <linearGradient id="fillA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={A_COLOR} stopOpacity={0.28} />
              <stop offset="100%" stopColor={A_COLOR} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fillB" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={B_COLOR} stopOpacity={0.28} />
              <stop offset="100%" stopColor={B_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="t"
            type="number"
            domain={[0, points[points.length - 1]?.t ?? 0]}
            ticks={xTicks(points)}
            tickFormatter={mmss}
            stroke="#27272a"
            tickLine={false}
            tick={{ fill: "#52525b", fontSize: 11, fontFamily: "monospace" }}
          />
          <YAxis
            domain={[lo, hi]}
            tickFormatter={tickFormat(hi - lo)}
            stroke="transparent"
            tickLine={false}
            tick={{ fill: "#52525b", fontSize: 11, fontFamily: "monospace" }}
            width={58}
          />

          {/* Break-even: above it an agent is up on the duel, below it down. */}
          <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="4 4" />

          <Tooltip
            cursor={{ stroke: "#52525b", strokeWidth: 1 }}
            contentStyle={{
              background: "rgba(9,9,11,0.94)",
              border: "1px solid #27272a",
              borderRadius: 8,
              fontFamily: "monospace",
              fontSize: 12,
              padding: "8px 10px",
            }}
            labelStyle={{ color: "#a1a1aa", marginBottom: 4 }}
            labelFormatter={(t: number) => `t + ${mmss(t)}`}
            formatter={(v, name) => [pct(typeof v === "number" ? v : null), String(name)]}
          />

          {/*
            tooltipType="none" as well as legendType: the fills share their keys
            with the lines, so the tooltip listed every value twice — once as the
            raw "a"/"b" and once under the bot's name.
          */}
          <Area type="monotone" dataKey="a" stroke="none" fill="url(#fillA)"
                isAnimationActive={false} connectNulls legendType="none" tooltipType="none" />
          <Area type="monotone" dataKey="b" stroke="none" fill="url(#fillB)"
                isAnimationActive={false} connectNulls legendType="none" tooltipType="none" />

          <Line type="monotone" dataKey="a" name={labelA} stroke={A_COLOR}
                strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="b" name={labelB} stroke={B_COLOR}
                strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />

          {/*
            A dot on the last value of each side.

            Where a line ends is the thing you look for on a live chart, and two
            curves that stop mid-air leave you hunting for which is which. The
            reading itself sits beside the chart, not on it — labels on the plot
            collide the moment the two are close, which is exactly when it
            matters.
          */}
          {last.a !== null && (
            <ReferenceDot x={last.t} y={last.a} r={3.5} fill={A_COLOR} stroke="none"
                          isFront ifOverflow="extendDomain" />
          )}
          {last.b !== null && (
            <ReferenceDot x={last.t} y={last.b} r={3.5} fill={B_COLOR} stroke="none"
                          isFront ifOverflow="extendDomain" />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
