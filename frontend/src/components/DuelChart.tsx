"use client";

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
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

  return (
    <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
      <div className="flex items-center gap-5 mb-3 px-2">
        <span className="text-[11px] font-mono flex items-center gap-2">
          <span className="w-3 h-[2px]" style={{ background: A_COLOR }} />
          <span className="text-zinc-400">{labelA}</span>
        </span>
        <span className="text-[11px] font-mono flex items-center gap-2">
          <span className="w-3 h-[2px]" style={{ background: B_COLOR }} />
          <span className="text-zinc-400">{labelB}</span>
        </span>

        {gap !== null && (
          <span className="text-[11px] font-mono ml-auto">
            {gap === 0 ? (
              <span className="text-zinc-500">level — a tie goes to {labelB}</span>
            ) : (
              <>
                <span className="text-zinc-600">gap </span>
                <span style={{ color: gap > 0 ? A_COLOR : B_COLOR }}>
                  {Math.abs(gap / 100).toFixed(2)}%
                </span>
                <span className="text-zinc-600">
                  {" "}to {gap > 0 ? labelA : labelB}
                </span>
              </>
            )}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={points} margin={{ top: 4, right: 12, bottom: 4, left: -8 }}>
          <XAxis
            dataKey="t"
            type="number"
            domain={[0, points[points.length - 1]?.t ?? 0]}
            ticks={xTicks(points)}
            tickFormatter={mmss}
            stroke="#3f3f46"
            tick={{ fill: "#71717a", fontSize: 11, fontFamily: "monospace" }}
          />
          <YAxis
            domain={[lo, hi]}
            tickFormatter={tickFormat(hi - lo)}
            stroke="#3f3f46"
            tick={{ fill: "#71717a", fontSize: 11, fontFamily: "monospace" }}
            width={58}
          />
          {/* Break-even: above it an agent is up on the duel, below it down. */}
          <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{
              background: "#09090b", border: "1px solid #27272a",
              borderRadius: 6, fontFamily: "monospace", fontSize: 12,
            }}
            labelFormatter={(t: number) => `t + ${mmss(t)}`}
            formatter={(v, name) => [pct(typeof v === "number" ? v : null), String(name)]}
          />
          <Line type="monotone" dataKey="a" name={labelA} stroke={A_COLOR}
                strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="b" name={labelB} stroke={B_COLOR}
                strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
