"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const DUEL_MANAGER_ABI = [
  "function getDuel(uint256 duelId) view returns (address agentA, address agentB, uint256 stake, uint256 startTime, uint256 endTime, uint8 state, address winner, bool agentASubmitted, bool agentBSubmitted, uint256 createdAt)",
  "function getLivePnL(uint256 duelId) view returns (int256 pnlA, int256 pnlB, uint256 updatedA, uint256 updatedB)",
  "function getFinalPnLStatus(uint256 duelId) view returns (bool agentASettled, bool agentBSettled, uint256 windowClosesAt)",
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

/**
 * Settlement progress. Between endTime and windowClosesAt each agent submits its
 * final score encrypted; once the window shuts anyone may call resolveDuel.
 */
export interface SettlementStatus {
  agentASettled: boolean;
  agentBSettled: boolean;
  windowClosesAt: number;
}

export function useDuel(duelId: number) {
  const [duel, setDuel] = useState<DuelData | null>(null);
  const [livePnL, setLivePnL] = useState<LivePnL>({ pnlA: 0, pnlB: 0 });
  const [settlement, setSettlement] = useState<SettlementStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    const dmAddr = process.env.NEXT_PUBLIC_DUEL_MANAGER_ADDRESS;
    if (!dmAddr || !duelId) return;
    try {
      const provider = new ethers.JsonRpcProvider(
        process.env.NEXT_PUBLIC_COTI_RPC || "https://testnet.coti.io/rpc"
      );
      const contract = new ethers.Contract(dmAddr, DUEL_MANAGER_ABI, provider);

      const [rawDuel, rawPnL, rawSettle] = await Promise.all([
        contract.getDuel(duelId),
        contract.getLivePnL(duelId).catch(() => [0, 0, 0, 0]),
        contract.getFinalPnLStatus(duelId).catch(() => null),
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

      setSettlement(
        rawSettle
          ? {
              agentASettled: rawSettle[0],
              agentBSettled: rawSettle[1],
              windowClosesAt: Number(rawSettle[2]) * 1000,
            }
          : null,
      );
    } catch (e) {
      console.error("Failed to fetch duel:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Every two seconds, not fifteen. The agents publish every few seconds and
    // the chain has the new score long before the page asked for it — a duel
    // that was moving on-chain looked frozen for fifteen seconds at a time, and
    // no amount of speeding the agents up could show through a poll that slow.
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duelId]);

  return { duel, livePnL, settlement, loading, refresh: fetchData };
}
