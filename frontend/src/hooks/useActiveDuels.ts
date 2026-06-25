"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const DUEL_MANAGER_ABI = [
  "function duelCount() view returns (uint256)",
  "function getDuel(uint256 duelId) view returns (address, address, uint256, uint256, uint256, uint8, address, bool, bool)",
];

interface DuelSummary {
  id: number;
  agentA: string;
  agentB: string;
  stake: bigint;
  endTime: bigint;
  state: number;
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
        promises.push(contract.getDuel(i).then((d: [string, string, bigint, bigint, bigint, number, string, boolean, boolean]) => ({ id: i, d })));
      }

      const results = await Promise.all(promises);
      for (const { id, d } of results) {
        const state = Number(d[5]);
        if (state === 0 || state === 1) { // Open or Active
          active.push({
            id,
            agentA: d[0],
            agentB: d[1],
            stake: d[2],
            endTime: d[4],
            state,
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
