"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const DUEL_MANAGER_ABI = [
  "function getDuel(uint256 duelId) view returns (address, address, uint256, uint256, uint256, uint8, address, bool, bool)",
  "function getLivePnL(uint256 duelId) view returns (int256, int256, uint256, uint256)",
  "function getPnLHistory(uint256 duelId) view returns (int256[], int256[])",
];

interface DuelData {
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

interface PnLHistory {
  historyA: number[];
  historyB: number[];
}

export function useDuel(duelId: number) {
  const [duel, setDuel] = useState<DuelData | null>(null);
  const [livePnL, setLivePnL] = useState<LivePnL>({ pnlA: 0, pnlB: 0 });
  const [pnlHistory, setPnlHistory] = useState<PnLHistory>({ historyA: [], historyB: [] });
  const [loading, setLoading] = useState(true);

  const getContract = () => {
    const provider = new ethers.JsonRpcProvider(
      process.env.NEXT_PUBLIC_COTI_RPC || "https://testnet.coti.io/rpc"
    );
    return new ethers.Contract(
      process.env.NEXT_PUBLIC_DUEL_MANAGER_ADDRESS!,
      DUEL_MANAGER_ABI,
      provider
    );
  };

  const fetchData = async () => {
    if (!process.env.NEXT_PUBLIC_DUEL_MANAGER_ADDRESS) return;
    try {
      const contract = getContract();

      const [rawDuel, rawPnL, rawHistory] = await Promise.all([
        contract.getDuel(duelId),
        contract.getLivePnL(duelId),
        contract.getPnLHistory(duelId),
      ]);

      setDuel({
        agentA: rawDuel[0],
        agentB: rawDuel[1],
        stake: rawDuel[2],
        startTime: rawDuel[3],
        endTime: rawDuel[4],
        state: Number(rawDuel[5]),
        winner: rawDuel[6],
        agentASubmitted: rawDuel[7],
        agentBSubmitted: rawDuel[8],
      });

      setLivePnL({
        pnlA: Number(rawPnL[0]),
        pnlB: Number(rawPnL[1]),
      });

      setPnlHistory({
        historyA: rawHistory[0].map(Number),
        historyB: rawHistory[1].map(Number),
      });
    } catch (e) {
      console.error("Failed to fetch duel:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // Poll every 15s
    return () => clearInterval(interval);
  }, [duelId]);

  return { duel, livePnL, pnlHistory, loading };
}
