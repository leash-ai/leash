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
 * A y range that stays readable when nothing much happens.
 *
 * Two agents both sitting at 0 gave recharts a zero-height domain, which it
 * filled with five ticks all reading "0.0%" — an axis that says nothing. Pad
 * around whatever the data does, never narrower than ±0.1%, and keep zero in
 * frame so being up or down is legible at a glance.
 */
function yDomain(points: PnlPoint[]): [number, number] {
  const vals = points.flatMap((p) => [p.a, p.b]).filter((v): v is number => v !== null);
  if (vals.length === 0) return [-10, 10];
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const pad = Math.max(10, (hi - lo) * 0.2);   // 10bps = 0.1%
  return [Math.floor(lo - pad), Math.ceil(hi + pad)];
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
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={points} margin={{ top: 4, right: 12, bottom: 4, left: -8 }}>
          <XAxis
            dataKey="t"
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
