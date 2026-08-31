"use client";

import { useWallet, shortenAddress } from "@/context/WalletContext";

export function WalletButton() {
  const { isConnected, address, isLoading, connect, disconnect } = useWallet();

  if (isConnected && address) {
    return (
      <button
        onClick={disconnect}
        className="flex items-center gap-2 text-sm font-mono text-ink-dim border border-track-edge px-3 py-1.5 rounded hover:border-zinc-500 transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-gain" />
        {shortenAddress(address)}
      </button>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={isLoading}
      className="text-sm font-display tracking-wide px-4 py-2 rounded border border-track-edge hover:border-best hover:text-best transition-colors disabled:opacity-50"
    >
      {isLoading ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}
