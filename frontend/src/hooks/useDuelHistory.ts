"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const ABI = [
  "event LivePnLUpdated(uint256 indexed duelId, address indexed agent, int256 pnlBps)",
];

export interface PnlPoint {
  /** Seconds since the duel started — the x axis. */
  t: number;
  a: number | null;
  b: number | null;
}

/**
 * The PnL history of a duel, rebuilt from LivePnLUpdated logs.
 *
 * The contract keeps only each agent's latest score, but it emits one event per
 * update, so the whole curve is recoverable without storing it. Timestamps come
 * from the blocks the logs sit in — a handful per duel, fetched once each.
 *
 * Both series are carried forward between points: an agent that has not reported
 * since its last update has not moved, and a line that disappears between ticks
 * would read as missing data rather than a flat position.
 */
export function useDuelHistory(
  duelId: number,
  agentA: string | undefined,
  agentB: string | undefined,
  startTime: number | undefined,
  refreshKey: number,
) {
  const [points, setPoints] = useState<PnlPoint[]>([]);

  useEffect(() => {
    const dmAddr = process.env.NEXT_PUBLIC_DUEL_MANAGER_ADDRESS;
    if (!dmAddr || !duelId || !agentA || !startTime) return;
    let cancelled = false;

    (async () => {
      try {
        const provider = new ethers.JsonRpcProvider(
          process.env.NEXT_PUBLIC_COTI_RPC || "https://testnet.coti.io/rpc",
        );
        const contract = new ethers.Contract(dmAddr, ABI, provider);
        const logs = await contract.queryFilter(contract.filters.LivePnLUpdated(duelId));
        if (cancelled || logs.length === 0) return;

        const blocks = [...new Set(logs.map((l) => l.blockNumber))];
        const times = new Map<number, number>();
        await Promise.all(
          blocks.map(async (n) => {
            const b = await provider.getBlock(n);
            if (b) times.set(n, b.timestamp);
          }),
        );

        const a = agentA.toLowerCase();
        let lastA: number | null = null;
        let lastB: number | null = null;
        const out: PnlPoint[] = [];

        for (const log of logs) {
          if (!("args" in log)) continue;
          const who = String((log as ethers.EventLog).args[1]).toLowerCase();
          const bps = Number((log as ethers.EventLog).args[2]);
          if (who === a) lastA = bps;
          else lastB = bps;

          const ts = times.get(log.blockNumber);
          if (ts === undefined) continue;

          // Both agents report within a second or two of each other, which used
          // to produce two points per tick at the same x — and an axis that
          // printed every label twice. One point per instant, carrying whatever
          // each side last said.
          const t = Math.max(0, ts - startTime);
          const prev = out[out.length - 1];
          if (prev && prev.t === t) {
            prev.a = lastA;
            prev.b = lastB;
          } else {
            out.push({ t, a: lastA, b: lastB });
          }
        }

        if (!cancelled) setPoints(out);
      } catch {
        // A missing curve is not worth breaking the page over.
      }
    })();

    return () => { cancelled = true; };
  }, [duelId, agentA, agentB, startTime, refreshKey]);

  return points;
}
