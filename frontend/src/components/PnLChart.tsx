"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface PnLChartProps {
  historyA: number[];
  historyB: number[];
}

export function PnLChart({ historyA, historyB }: PnLChartProps) {
  const maxLen = Math.max(historyA.length, historyB.length, 1);

  const data = Array.from({ length: maxLen }, (_, i) => ({
    t: i,
    agentA: historyA[i] !== undefined ? historyA[i] / 100 : null,
    agentB: historyB[i] !== undefined ? historyB[i] / 100 : null,
  }));

  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-zinc-700 font-mono text-sm">
        Waiting for first PnL update...
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
        <XAxis dataKey="t" hide />
        <YAxis
          tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
          tick={{ fill: "#52525b", fontSize: 11, fontFamily: "monospace" }}
          width={60}
        />
        <Tooltip
          contentStyle={{ background: "#111", border: "1px solid #27272a", fontFamily: "monospace", fontSize: 12 }}
          formatter={(value: number) => [`${value > 0 ? "+" : ""}${value.toFixed(2)}%`]}
        />
        <ReferenceLine y={0} stroke="#27272a" />
        <Line
          type="monotone"
          dataKey="agentA"
          stroke="#00ff88"
          strokeWidth={2}
          dot={false}
          connectNulls
          name="Agent A"
        />
        <Line
          type="monotone"
          dataKey="agentB"
          stroke="#3b9eff"
          strokeWidth={2}
          dot={false}
          connectNulls
          name="Agent B"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
