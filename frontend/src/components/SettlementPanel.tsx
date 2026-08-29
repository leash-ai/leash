"use client";

import { useState } from "react";
import { ethers } from "ethers";
import { SettlementStatus } from "@/hooks/useDuel";

/** DuelManager.RESOLVER_FEE_BPS — paid to whoever calls resolveDuel. */
// BigInt(...) rather than a literal: the frontend tsconfig targets below ES2020.
const RESOLVER_FEE_BPS = BigInt(50);

interface Props {
  duelId: number;
  stake: bigint;
  settlement: SettlementStatus;
  /** Wall-clock ms, passed in so the countdown shares the page's ticking clock. */
  now: number;
  onResolved: () => void;
}

/**
 * What happens between the final whistle and the payout.
 *
 * A duel does not resolve itself. Once the settlement window shuts it sits
 * Active, holding both stakes, until somebody calls resolveDuel — which anyone
 * may do, and which pays them RESOLVER_FEE_BPS of the pot. Nothing in the app
 * offered that, so duels simply stayed unresolved and the stakes stayed put.
 */
/**
 * One side's settlement status.
 *
 * Outside the panel on purpose: a component declared inside another component's
 * body is a new type on every render, so React unmounts and rebuilds it instead
 * of updating it. This panel re-renders on a countdown.
 */
function Tick({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={done ? "text-[#00ff88]" : "text-zinc-600"}>{done ? "●" : "○"}</span>
      <span className={`text-xs font-mono ${done ? "text-zinc-300" : "text-zinc-500"}`}>
        {label} {done ? "settled" : "pending"}
      </span>
    </div>
  );
}

export function SettlementPanel({ duelId, stake, settlement, now, onResolved }: Props) {
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const windowOpen = now < settlement.windowClosesAt;
  const secondsLeft = Math.max(0, Math.ceil((settlement.windowClosesAt - now) / 1000));
  const bonus = (stake * BigInt(2) * RESOLVER_FEE_BPS) / BigInt(10000);

  const resolve = async () => {
    setResolving(true);
    setError(null);
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
        ["function resolveDuel(uint256 duelId)"],
        signer,
      );
      const tx = await contract.resolveDuel(duelId);
      await tx.wait();
      onResolved();
    } catch (e: unknown) {
      setError((e as Error).message?.slice(0, 120) || "Transaction failed");
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="border border-zinc-800 rounded-lg p-6 bg-zinc-950">
      {windowOpen ? (
        <>
          <div className="flex items-baseline justify-between mb-4">
            <div className="text-[#00ff88] text-xs font-mono">SETTLEMENT WINDOW</div>
            <div className="font-mono text-sm text-zinc-400">{secondsLeft}s left</div>
          </div>
          <p className="text-xs text-zinc-500 font-mono mb-4">
            Each agent now submits its final score encrypted, pinned to the last figure it
            reported. An agent that does not settle forfeits.
          </p>
          <div className="flex gap-6">
            <Tick done={settlement.agentASettled} label="Agent A" />
            <Tick done={settlement.agentBSettled} label="Agent B" />
          </div>
        </>
      ) : (
        <>
          <div className="text-[#00ff88] text-xs font-mono mb-2">READY TO RESOLVE</div>
          <p className="text-xs text-zinc-500 font-mono mb-4">
            The window has closed. Anyone can settle this duel — a garbled circuit compares the
            two encrypted scores and pays out. Whoever calls it earns{" "}
            <span className="text-zinc-300">{ethers.formatEther(bonus)} COTI</span> for the gas.
          </p>
          <div className="flex gap-6 mb-4">
            <Tick done={settlement.agentASettled} label="Agent A" />
            <Tick done={settlement.agentBSettled} label="Agent B" />
          </div>
          <button
            onClick={resolve}
            disabled={resolving}
            className="bg-[#00ff88] text-black font-mono text-sm px-4 py-2 rounded hover:bg-[#00e57a] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resolving ? "Resolving…" : `Resolve duel — earn ${ethers.formatEther(bonus)} COTI`}
          </button>
          {error && <div className="mt-3 text-xs font-mono text-red-400">{error}</div>}
        </>
      )}
    </div>
  );
}
