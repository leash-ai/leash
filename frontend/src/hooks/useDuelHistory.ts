"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const ABI = [
  "event LivePnLUpdated(uint256 indexed duelId, address indexed agent, int256 pnlBps)",
  "event LivePnLBatch(uint256 indexed duelId, address indexed agent, int256[] pnlBps, uint32[] ageMs)",
];

export interface PnlPoint {
  /** Seconds since the duel started — the x axis. */
  t: number;
  a: number | null;
  b: number | null;
}

/**
 * The PnL history of a duel, rebuilt from its logs.
 *
 * The contract keeps only each agent's latest score, but it emits every one, so
 * the whole curve is recoverable without storing it. Timestamps come from the
 * blocks the logs sit in — a handful per duel, fetched once each.
 *
 * Scores arrive in batches: a block here is about six seconds, so a transaction
 * per point capped the curve at a point every few seconds. LivePnLBatch carries
 * a run of them with how long before the transaction each was taken, which is
 * what puts sub-second resolution on a chart built from the chain rather than
 * from a stream someone has to trust.
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
        // Batches when they exist, single updates otherwise. A batch also emits
        // LivePnLUpdated for readers that only know the old shape, so taking
        // both would double every point.
        const batches = await contract.queryFilter(contract.filters.LivePnLBatch(duelId));
        const singles = await contract.queryFilter(contract.filters.LivePnLUpdated(duelId));
        const batched = new Set(batches.map((l) => `${l.blockNumber}:${l.transactionHash}`));
        const logs = [
          ...batches,
          ...singles.filter((l) => !batched.has(`${l.blockNumber}:${l.transactionHash}`)),
        ].sort((x, y) => x.blockNumber - y.blockNumber || x.index - y.index);
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

        /*
          Collect every sample first, then order by time, then carry forward.

          The two agents publish in different blocks, so their batches interleave
          in time even though the logs arrive one batch at a time. Carrying
          forward in log order and sorting afterwards would pair each score with
          whatever the other side happened to say later — a curve made of values
          that were never simultaneous.
        */
        const samples: { t: number; isA: boolean; bps: number }[] = [];

        for (const log of logs) {
          if (!("args" in log)) continue;
          const args = (log as ethers.EventLog).args;
          const isA = String(args[1]).toLowerCase() === a;

          const ts = times.get(log.blockNumber);
          if (ts === undefined) continue;
          const blockT = Math.max(0, ts - startTime);

          if ((log as ethers.EventLog).eventName === "LivePnLBatch") {
            const scores = args[2] as bigint[];
            const ages = args[3] as bigint[];
            for (let i = 0; i < scores.length; i++) {
              // ageMs is how long before the transaction the score was taken, so
              // it places the point behind the block it landed in.
              samples.push({
                t: Math.max(0, blockT - Number(ages[i]) / 1000),
                isA,
                bps: Number(scores[i]),
              });
            }
          } else {
            samples.push({ t: blockT, isA, bps: Number(args[2]) });
          }
        }

        samples.sort((x, y) => x.t - y.t);

        // One point per instant, carrying whatever each side last said. Both
        // agents reporting a second apart used to produce two points at the same
        // x and an axis that printed every label twice; sub-second offsets keep
        // their own x, which is the whole reason the batches exist.
        for (const sample of samples) {
          if (sample.isA) lastA = sample.bps;
          else lastB = sample.bps;

          const prev = out[out.length - 1];
          if (prev && Math.abs(prev.t - sample.t) < 0.05) {
            prev.a = lastA;
            prev.b = lastB;
          } else {
            out.push({ t: sample.t, a: lastA, b: lastB });
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
