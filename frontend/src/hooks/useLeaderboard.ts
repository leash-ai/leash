"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const REGISTRY_ABI = [
  "function agentCount() view returns (uint256)",
  "function getTopAgents(uint256 limit) view returns (uint256[] agentIds, tuple(string name, string avatarUri, uint256 mintedAt, uint256 wins, uint256 losses, uint256 draws, uint256 totalFights, uint256 rentalCount, uint256 totalEarned, uint256 rentalEarned)[] profiles)",
];

export interface AgentEntry {
  agentId: number;
  name: string;
  wins: number;
  losses: number;
  totalFights: number;
  winRateBps: number;
  totalEarnedCoti: number;
}

export function useLeaderboard() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const rpc = process.env.NEXT_PUBLIC_COTI_RPC || "https://testnet.coti.io/rpc";
      const regAddr = process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS;
      if (!regAddr) { setLoading(false); return; }

      try {
        const provider = new ethers.JsonRpcProvider(rpc);
        const reg = new ethers.Contract(regAddr, REGISTRY_ABI, provider);

        const count = Number(await reg.agentCount());
        if (count === 0) { setAgents([]); setLoading(false); return; }

        const [agentIds, profiles] = await reg.getTopAgents(count);

        const entries: AgentEntry[] = agentIds.map((id: bigint, i: number) => {
          const p = profiles[i];
          const wins = Number(p.wins);
          const total = Number(p.totalFights);
          return {
            agentId: Number(id),
            name: p.name,
            wins,
            losses: Number(p.losses),
            totalFights: total,
            winRateBps: total > 0 ? Math.round((wins * 10000) / total) : 0,
            totalEarnedCoti: Number(ethers.formatEther(p.totalEarned)),
          };
        });

        setAgents(entries);
      } catch (e) {
        console.error("useLeaderboard failed:", e);
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, []);

  return { agents, loading };
}
