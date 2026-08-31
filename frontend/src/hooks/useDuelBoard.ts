"use client";

/**
 * Everything on the board: what is running, and what has already run.
 *
 * The home page used to list only live duels, so on a quiet minute it was an
 * empty box under a hero — a product with nothing happening in it. Finished
 * duels are the other half of the board and they are not dead weight: the curve
 * is rebuilt from the chain, so any of them can be watched back in full.
 *
 * One scan for both, because they come from the same call. Splitting it into two
 * hooks would double the RPC traffic to answer one question.
 */
import { useEffect, useState } from "react";
import { ethers } from "ethers";

const ABI = [
  "function duelCount() view returns (uint256)",
  "function getDuel(uint256 duelId) view returns (address agentA, address agentB, uint256 stake, uint256 startTime, uint256 endTime, uint8 state, address winner, bool agentASubmitted, bool agentBSubmitted, uint256 createdAt)",
  "function getLivePnL(uint256 duelId) view returns (int256 pnlA, int256 pnlB)",
];

export interface BoardDuel {
  id: number;
  agentA: string;
  agentB: string;
  stake: bigint;
  startTime: bigint;
  endTime: bigint;
  state: number;
  winner: string;
  pnlA: number | null;
  pnlB: number | null;
}

/** Enough history for a rail worth scrolling, few enough to stay one round. */
const DEPTH = 40;

export function useDuelBoard(refreshMs = 5000) {
  const [live, setLive] = useState<BoardDuel[]>([]);
  const [finished, setFinished] = useState<BoardDuel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const address = process.env.NEXT_PUBLIC_DUEL_MANAGER_ADDRESS;
      if (!address) { setLoading(false); return; }

      try {
        const provider = new ethers.JsonRpcProvider(
          process.env.NEXT_PUBLIC_COTI_RPC || "https://testnet.coti.io/rpc",
        );
        const duels = new ethers.Contract(address, ABI, provider);

        const count = Number(await duels.duelCount());
        const first = Math.max(1, count - DEPTH + 1);
        const ids = Array.from({ length: count - first + 1 }, (_, k) => first + k);

        // In batches. Forty concurrent getDuel calls at the public COTI RPC
        // leaves the page loading indefinitely, which reads as a broken hook.
        const rows: { id: number; d: any }[] = [];
        for (let i = 0; i < ids.length; i += 10) {
          const batch = await Promise.all(
            ids.slice(i, i + 10).map((id) =>
              duels.getDuel(id).then((d: any) => ({ id, d })).catch(() => null),
            ),
          );
          if (cancelled) return;
          rows.push(...batch.filter((r): r is { id: number; d: any } => r !== null));
        }

        /*
          Scores for every duel, finished ones included.

          getDuel does not carry them — getLivePnL is the only source, and a
          resolved duel keeps the last value each side published. Fetching only
          the running ones left every replay card blank, which is the one thing
          a replay has to show.
        */
        const scores = new Map<number, { a: number; b: number }>();
        for (let i = 0; i < rows.length; i += 10) {
          await Promise.all(
            rows.slice(i, i + 10).map(({ id }) =>
              duels
                .getLivePnL(id)
                .then((p: [bigint, bigint]) => scores.set(id, { a: Number(p[0]), b: Number(p[1]) }))
                .catch(() => {}),
            ),
          );
          if (cancelled) return;
        }

        const shape = (id: number, d: any): BoardDuel => ({
          id,
          agentA: d.agentA,
          agentB: d.agentB,
          stake: d.stake,
          startTime: d.startTime,
          endTime: d.endTime,
          state: Number(d.state),
          winner: d.winner,
          pnlA: d.agentASubmitted ? (scores.get(id)?.a ?? null) : null,
          pnlB: d.agentBSubmitted ? (scores.get(id)?.b ?? null) : null,
        });

        setLive(rows.filter(({ d }) => Number(d.state) <= 1).map(({ id, d }) => shape(id, d)).reverse());
        setFinished(rows.filter(({ d }) => Number(d.state) === 2).map(({ id, d }) => shape(id, d)).reverse());
      } catch (e) {
        console.error("Failed to read the duel board:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const timer = setInterval(load, refreshMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [refreshMs]);

  return { live, finished, loading };
}
