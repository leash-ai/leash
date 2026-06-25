"use client";

import { useState } from "react";

interface Props {
  onClose: () => void;
}

const DURATIONS = [
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "24 hours", value: 86400 },
  { label: "7 days", value: 604800 },
];

export function CreateDuelModal({ onClose }: Props) {
  const [stake, setStake] = useState("0.1");
  const [duration, setDuration] = useState(86400);
  const [creating, setCreating] = useState(false);
  const [duelId, setDuelId] = useState<number | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    try {
      // Connect to MetaMask / COTI wallet
      if (typeof window.ethereum === "undefined") {
        alert("Please install MetaMask and connect to COTI Testnet");
        return;
      }

      // Ensure COTI testnet
      const COTI_CHAIN_ID = "0x6C11A0";
      const currentChain = await window.ethereum.request({ method: "eth_chainId" });
      if (currentChain !== COTI_CHAIN_ID) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: COTI_CHAIN_ID }],
          });
        } catch (switchErr: any) {
          if (switchErr.code === 4902) {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: COTI_CHAIN_ID,
                chainName: "COTI Testnet",
                nativeCurrency: { name: "COTI", symbol: "COTI", decimals: 18 },
                rpcUrls: ["https://testnet.coti.io/rpc"],
                blockExplorerUrls: ["https://explorer-devnet.coti.io"],
              }],
            });
          } else throw switchErr;
        }
      }

      const { ethers } = await import("ethers");
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();

      const DUEL_MANAGER_ABI = [
        "function createDuel(uint256 duration) payable returns (uint256)",
        "event DuelCreated(uint256 indexed duelId, address indexed agentA, uint256 stake, uint256 duration)",
      ];

      const contract = new ethers.Contract(
        process.env.NEXT_PUBLIC_DUEL_MANAGER_ADDRESS!,
        DUEL_MANAGER_ABI,
        signer
      );

      const tx = await contract.createDuel(duration, {
        value: ethers.parseEther(stake),
      });

      const receipt = await tx.wait();
      const event = receipt?.logs.find((log: { topics: string[] }) =>
        log.topics[0] === ethers.id("DuelCreated(uint256,address,uint256,uint256)")
      );

      if (event) {
        const id = parseInt(event.topics[1], 16);
        setDuelId(id);
      }
    } catch (e: unknown) {
      const err = e as Error;
      console.error(err);
      alert(`Error: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-8 w-full max-w-md">
        {duelId ? (
          <div className="text-center">
            <div className="text-4xl mb-4">⚔️</div>
            <h2 className="text-xl font-bold mb-2">Duel #{duelId} created!</h2>
            <p className="text-zinc-500 text-sm mb-6">
              Share this ID with your opponent. They&apos;ll need to join with the same stake.
            </p>
            <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 font-mono text-2xl text-center mb-6">
              #{duelId}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => window.location.href = `/duel/${duelId}`}
                className="flex-1 bg-[#00ff88] text-black font-bold py-3 rounded-lg hover:bg-[#00cc6a] transition-colors"
              >
                Watch live
              </button>
              <button
                onClick={onClose}
                className="flex-1 border border-zinc-700 py-3 rounded-lg hover:border-zinc-500 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold mb-6">Create a Duel</h2>

            <div className="space-y-5">
              <div>
                <label className="text-sm text-zinc-400 block mb-2">Stake (COTI)</label>
                <input
                  type="number"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 font-mono focus:outline-none focus:border-[#00ff88] transition-colors"
                  step="0.01"
                  min="0.01"
                />
              </div>

              <div>
                <label className="text-sm text-zinc-400 block mb-2">Duration</label>
                <div className="grid grid-cols-2 gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => setDuration(d.value)}
                      className={`border rounded-lg py-2.5 text-sm font-mono transition-colors ${
                        duration === d.value
                          ? "border-[#00ff88] text-[#00ff88] bg-[#00ff88]/10"
                          : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border border-zinc-800 rounded-lg p-4 text-sm text-zinc-500 font-mono">
                <div className="flex justify-between mb-1">
                  <span>Your stake</span>
                  <span>{stake} COTI</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span>Opponent stake</span>
                  <span>{stake} COTI</span>
                </div>
                <div className="flex justify-between mb-1 text-zinc-600">
                  <span>Protocol fee</span>
                  <span>5%</span>
                </div>
                <div className="border-t border-zinc-800 mt-2 pt-2 flex justify-between font-bold text-white">
                  <span>Prize pool</span>
                  <span className="text-[#00ff88]">{(parseFloat(stake) * 2 * 0.95).toFixed(4)} COTI</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 bg-[#00ff88] text-black font-bold py-3 rounded-lg hover:bg-[#00cc6a] transition-colors disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Duel"}
              </button>
              <button
                onClick={onClose}
                className="border border-zinc-700 px-6 py-3 rounded-lg hover:border-zinc-500 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
