"use client";

import { useState } from "react";

interface Props {
  onClose: () => void;
}

/**
 * One stake, three lengths, three strategies.
 *
 * A free-text stake and five durations meant two duels almost never matched, and
 * an unmatched duel is a page that says "waiting for opponent" until you close
 * it. Everyone putting up the same amount is what makes a challenge joinable by
 * anyone who happens to be looking.
 */
const STAKE_COTI = "0.1";

const DURATIONS = [
  { label: "2 min", sub: "quick", value: 120 },
  { label: "10 min", sub: "a real race", value: 600 },
  { label: "1 hour", sub: "let it run", value: 3600 },
];

const STRATEGIES = [
  { id: "momentum", name: "Momentum", desc: "Buys whatever is climbing fastest" },
  { id: "meanReversion", name: "Mean reversion", desc: "Buys what has fallen, expects a bounce" },
  { id: "marketMaker", name: "Market maker", desc: "Works both sides, takes small edges" },
];

export function CreateDuelModal({ onClose }: Props) {
  const [duration, setDuration] = useState(600);
  const [strategy, setStrategy] = useState("momentum");
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
        value: ethers.parseEther(STAKE_COTI),
      });

      const receipt = await tx.wait();
      const event = receipt?.logs.find((log: { topics: string[] }) =>
        log.topics[0] === ethers.id("DuelCreated(uint256,address,uint256,uint256)")
      );

      if (event) {
        const id = parseInt(event.topics[1], 16);
        setDuelId(id);

        // Hand the duel to the agent server so the creator's side actually
        // trades. Without this you stake, watch a flat line and lose by forfeit
        // — which is precisely what happened the first time a duel was created
        // from this page. Best effort: the duel exists either way.
        const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL;
        if (agentUrl) {
          fetch(`${agentUrl}/agent/duel/${id}/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ strategy }),
          }).catch(() => {});
        }
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
                <label className="text-sm text-zinc-400 block mb-2">Your strategy</label>
                <div className="space-y-2">
                  {STRATEGIES.map((st) => (
                    <button
                      key={st.id}
                      onClick={() => setStrategy(st.id)}
                      className={`w-full text-left border rounded-lg px-4 py-2.5 transition-colors ${
                        strategy === st.id
                          ? "border-[#00ff88] bg-[#00ff88]/10"
                          : "border-zinc-700 hover:border-zinc-500"
                      }`}
                    >
                      <div className={`text-sm font-bold ${strategy === st.id ? "text-[#00ff88]" : "text-zinc-300"}`}>
                        {st.name}
                      </div>
                      <div className="text-xs text-zinc-500 font-mono">{st.desc}</div>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-600 font-mono mt-2">
                  It runs on your machine. Nobody sees it, including your opponent.
                </p>
              </div>

              <div>
                <label className="text-sm text-zinc-400 block mb-2">How long</label>
                <div className="grid grid-cols-3 gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => setDuration(d.value)}
                      className={`border rounded-lg py-2 transition-colors ${
                        duration === d.value
                          ? "border-[#00ff88] text-[#00ff88] bg-[#00ff88]/10"
                          : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                      }`}
                    >
                      <div className="text-sm font-mono">{d.label}</div>
                      <div className="text-[10px] text-zinc-600">{d.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border border-zinc-800 rounded-lg p-4 text-sm font-mono">
                <div className="flex justify-between text-zinc-500 mb-1">
                  <span>Stake — same for both sides</span>
                  <span className="text-zinc-300">{STAKE_COTI} COTI</span>
                </div>
                <div className="flex justify-between text-zinc-600 mb-2">
                  <span>Protocol fee</span>
                  <span>5%</span>
                </div>
                <div className="border-t border-zinc-800 pt-2 flex justify-between font-bold text-white">
                  <span>Winner takes</span>
                  <span className="text-[#00ff88]">
                    {(parseFloat(STAKE_COTI) * 2 * 0.95).toFixed(3)} COTI
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-zinc-600 font-mono leading-relaxed">
                One of our bots takes the challenge the moment you make it. Which one is
                random — six of them, each playing differently.
              </p>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 bg-[#00ff88] text-black font-bold py-3 rounded-lg hover:bg-[#00cc6a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? "Creating…" : `Challenge — ${STAKE_COTI} COTI`}
              </button>
              <button
                onClick={onClose}
                disabled={creating}
                className="px-6 border border-zinc-700 rounded-lg text-zinc-400 hover:border-zinc-500 disabled:opacity-50 transition-colors"
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
