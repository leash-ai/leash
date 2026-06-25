"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const DUEL_MANAGER_ABI = [
  "function duelCount() view returns (uint256)",
  "function getDuel(uint256 duelId) view returns (address, address, uint256, uint256, uint256, uint8, address, bool, bool)",
  "function getAgentStats(address agent) view returns (uint256, uint256, uint256)",
  "event DuelResolved(uint256 indexed duelId, address indexed winner, uint256 prize)",
];

interface AgentStats {
  address: string;
  wins: number;
  losses: number;
  stakeWon: number;
}

export function useLeaderboard() {
  const [agents, setAgents] = useState<AgentStats[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLeaderboard = async () => {
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

      // Get all resolved duels to find unique addresses
      const count = Number(await contract.duelCount());
      const addresses = new Set<string>();

      for (let i = 1; i <= count; i++) {
        const d = await contract.getDuel(i);
        if (d[0] !== ethers.ZeroAddress) addresses.add(d[0]);
        if (d[1] !== ethers.ZeroAddress) addresses.add(d[1]);
      }

      // Fetch stats for each address
      const statsPromises = Array.from(addresses).map(async (addr) => {
        const stats = await contract.getAgentStats(addr);
        return {
          address: addr,
          wins: Number(stats[0]),
          losses: Number(stats[1]),
          stakeWon: Number(stats[2]),
        };
      });

      const allStats = await Promise.all(statsPromises);
      const sorted = allStats
        .filter((s) => s.wins + s.losses > 0)
        .sort((a, b) => b.wins - a.wins || b.stakeWon - a.stakeWon);

      setAgents(sorted);
    } catch (e) {
      console.error("Leaderboard fetch failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  return { agents, loading };
}
