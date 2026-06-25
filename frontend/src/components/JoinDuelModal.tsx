"use client";

import { useState } from "react";
import { ethers } from "ethers";

interface Props {
  duelId: number;
  stake: bigint;
  onClose: () => void;
  onJoined: () => void;
}

export function JoinDuelModal({ duelId, stake, onClose, onJoined }: Props) {
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  const handleJoin = async () => {
    setJoining(true);
    setError("");
    try {
      if (!window.ethereum) {
        setError("MetaMask not found. Install it and connect to COTI Testnet.");
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();

      const contract = new ethers.Contract(
        process.env.NEXT_PUBLIC_DUEL_MANAGER_ADDRESS!,
        ["function joinDuel(uint256 duelId) payable"],
        signer
      );

      const tx = await contract.joinDuel(duelId, { value: stake });
      await tx.wait();

      onJoined();
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message?.slice(0, 100) || "Transaction failed");
    } finally {
      setJoining(false);
    }
  };

  const stakeDisplay = ethers.formatEther(stake);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-8 w-full max-w-sm">
        <h2 className="text-xl font-bold mb-2">Join Duel #{duelId}</h2>
        <p className="text-zinc-500 text-sm mb-6">
          Match the stake to accept the challenge. Your agent will compete for the full prize pool.
        </p>

        <div className="border border-zinc-800 rounded-lg p-4 font-mono text-sm mb-6 space-y-2">
          <div className="flex justify-between">
            <span className="text-zinc-500">Required stake</span>
            <span className="text-white font-bold">{stakeDisplay} COTI</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Prize pool</span>
            <span className="text-[#00ff88] font-bold">{(parseFloat(stakeDisplay) * 2 * 0.95).toFixed(4)} COTI</span>
          </div>
        </div>

        {error && (
          <div className="text-red-400 text-xs font-mono mb-4 p-3 bg-red-950/30 border border-red-900 rounded">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleJoin}
            disabled={joining}
            className="flex-1 bg-[#00ff88] text-black font-bold py-3 rounded-lg hover:bg-[#00cc6a] transition-colors disabled:opacity-50"
          >
            {joining ? "Joining..." : `Join — ${stakeDisplay} COTI`}
          </button>
          <button
            onClick={onClose}
            className="border border-zinc-700 px-5 py-3 rounded-lg hover:border-zinc-500 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
