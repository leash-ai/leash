"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const DUEL_MANAGER_ABI = [
  "function duelCount() view returns (uint256)",
  "function getDuel(uint256 duelId) view returns (address agentA, address agentB, uint256 stake, uint256 startTime, uint256 endTime, uint8 state, address winner, bool agentASubmitted, bool agentBSubmitted, uint256 createdAt)",
  "function getLivePnL(uint256 duelId) view returns (int256 pnlA, int256 pnlB)",
];

interface DuelSummary {
  id: number;
  agentA: string;
  agentB: string;
  stake: bigint;
  /** block.timestamp at join — what the opponent draw is derived from. */
  startTime: bigint;
  endTime: bigint;
  state: number;
  /** Latest published returns, in bps. Null until a side has reported. */
  pnlA: number | null;
  pnlB: number | null;
}

export function useActiveDuels() {
  const [duels, setDuels] = useState<DuelSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDuels = async () => {
    if (!process.env.NEXT_PUBLIC_DUEL_MANAGER_ADDRESS) {
      setLoading(false);
      return;
    }
    try {
      const provider = new ethers.JsonRpcProvider(
        process.env.NEXT_PUBLIC_COTI_RPC || "https://testnet.coti.io/rpc"
      );
      const contract = new ethers.Contract(
        process.env.NEXT_PUBLIC_DUEL_MANAGER_ADDRESS,
        DUEL_MANAGER_ABI,
        provider
      );

      const count = Number(await contract.duelCount());
      const active: DuelSummary[] = [];

      // Fetch last 20 duels
      const start = Math.max(1, count - 20);
      const promises = [];
      for (let i = start; i <= count; i++) {
        promises.push(contract.getDuel(i).then((d: any) => ({ id: i, d })));
      }

      const results = await Promise.all(promises);

      // Who is ahead is the reason to click a row, so it belongs in the row.
      // Only fetched for the ones actually listed — the scan covers 20 duels
      // and most of them are finished.
      const live = new Map<number, { a: number; b: number }>();
      const running = results.filter(({ d }) => Number(d.state) === 0 || Number(d.state) === 1);
      await Promise.all(
        running.map(({ id }) =>
          contract
            .getLivePnL(id)
            .then((p: [bigint, bigint]) => live.set(id, { a: Number(p[0]), b: Number(p[1]) }))
            .catch(() => {}),
        ),
      );

      for (const { id, d } of results) {
        const state = Number(d.state);
        if (state === 0 || state === 1) { // Open or Active
          active.push({
            id,
            agentA: d.agentA,
            agentB: d.agentB,
            stake: d.stake,
            startTime: d.startTime,
            endTime: d.endTime,
            state,
            pnlA: d.agentASubmitted ? (live.get(id)?.a ?? null) : null,
            pnlB: d.agentBSubmitted ? (live.get(id)?.b ?? null) : null,
          });
        }
      }

      setDuels(active.reverse()); // Most recent first
    } catch (e) {
      console.error("Failed to fetch duels:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDuels();
    const interval = setInterval(fetchDuels, 30000);
    return () => clearInterval(interval);
  }, []);

  return { duels, loading };
}
