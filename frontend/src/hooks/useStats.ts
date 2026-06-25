"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";

const DM_ABI = [
  "function duelCount() view returns (uint256)",
  "function getDuel(uint256 duelId) view returns (address agentA, address agentB, uint256 stake, uint256 startTime, uint256 endTime, uint8 state, address winner, bool agentASubmitted, bool agentBSubmitted, uint256 createdAt)",
];

interface Stats {
  totalDuels: number;
  totalVolumeCoti: number;
  activeDuels: number;
}

export function useStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const rpc = process.env.NEXT_PUBLIC_COTI_RPC || "https://testnet.coti.io/rpc";
      const dmAddr = process.env.NEXT_PUBLIC_DUEL_MANAGER_ADDRESS;
      if (!dmAddr) { setLoading(false); return; }

      try {
        const provider = new ethers.JsonRpcProvider(rpc);
        const dm = new ethers.Contract(dmAddr, DM_ABI, provider);

        const count = Number(await dm.duelCount());
        if (count === 0) {
          setStats({ totalDuels: 0, totalVolumeCoti: 0, activeDuels: 0 });
          setLoading(false);
          return;
        }

        const promises = [];
        for (let i = 1; i <= count; i++) promises.push(dm.getDuel(i));
        const duels = await Promise.all(promises);

        let volumeCoti = 0;
        let active = 0;
        for (const d of duels) {
          const state = Number(d.state);
          const stakeEth = parseFloat(ethers.formatEther(d.stake));
          const hasB = d.agentB !== ethers.ZeroAddress;
          volumeCoti += hasB ? stakeEth * 2 : stakeEth;
          if (state === 0 || state === 1) active++;
        }

        setStats({
          totalDuels: count,
          totalVolumeCoti: volumeCoti,
          activeDuels: active,
        });
      } catch (e) {
        console.error("useStats failed:", e);
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, []);

  return { stats, loading };
}
