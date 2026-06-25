"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const DUEL_MANAGER_ABI = [
  "function getDuel(uint256 duelId) view returns (address agentA, address agentB, uint256 stake, uint256 startTime, uint256 endTime, uint8 state, address winner, bool agentASubmitted, bool agentBSubmitted, uint256 createdAt)",
  "function getLivePnL(uint256 duelId) view returns (int256 pnlA, int256 pnlB, uint256 updatedA, uint256 updatedB)",
];

export interface DuelData {
  agentA: string;
  agentB: string;
  stake: bigint;
  startTime: bigint;
  endTime: bigint;
  state: number;
  winner: string;
  agentASubmitted: boolean;
  agentBSubmitted: boolean;
}

interface LivePnL {
  pnlA: number;
  pnlB: number;
}

export function useDuel(duelId: number) {
  const [duel, setDuel] = useState<DuelData | null>(null);
  const [livePnL, setLivePnL] = useState<LivePnL>({ pnlA: 0, pnlB: 0 });
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    const dmAddr = process.env.NEXT_PUBLIC_DUEL_MANAGER_ADDRESS;
    if (!dmAddr || !duelId) return;
    try {
      const provider = new ethers.JsonRpcProvider(
        process.env.NEXT_PUBLIC_COTI_RPC || "https://testnet.coti.io/rpc"
      );
      const contract = new ethers.Contract(dmAddr, DUEL_MANAGER_ABI, provider);

      const [rawDuel, rawPnL] = await Promise.all([
        contract.getDuel(duelId),
        contract.getLivePnL(duelId).catch(() => [0, 0, 0, 0]),
      ]);

      setDuel({
        agentA: rawDuel.agentA,
        agentB: rawDuel.agentB,
        stake: rawDuel.stake,
        startTime: rawDuel.startTime,
        endTime: rawDuel.endTime,
        state: Number(rawDuel.state),
        winner: rawDuel.winner,
        agentASubmitted: rawDuel.agentASubmitted,
        agentBSubmitted: rawDuel.agentBSubmitted,
      });

      setLivePnL({
        pnlA: Number(rawPnL[0]),
        pnlB: Number(rawPnL[1]),
      });
    } catch (e) {
      console.error("Failed to fetch duel:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duelId]);

  return { duel, livePnL, loading };
}
