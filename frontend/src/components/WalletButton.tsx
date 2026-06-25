"use client";

import { useState, useEffect } from "react";

const COTI_CHAIN_ID = "0x6C0B20"; // 7082400

const COTI_CHAIN_PARAMS = {
  chainId: COTI_CHAIN_ID,
  chainName: "COTI Testnet",
  nativeCurrency: { name: "COTI", symbol: "COTI", decimals: 18 },
  rpcUrls: ["https://testnet.coti.io/rpc"],
  blockExplorerUrls: ["https://explorer-devnet.coti.io"],
};

async function ensureCotiChain() {
  const eth = window.ethereum;
  if (!eth) return;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: COTI_CHAIN_ID }],
    });
  } catch (err: any) {
    if (err.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [COTI_CHAIN_PARAMS],
      });
    }
  }
}

export function WalletButton() {
  const [address, setAddress] = useState<string | null>(null);
  const [onCoti, setOnCoti] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const refresh = async () => {
    const eth = window.ethereum;
    if (!eth) return;
    const [accounts, chainId] = await Promise.all([
      eth.request({ method: "eth_accounts" }) as Promise<string[]>,
      eth.request({ method: "eth_chainId" }) as Promise<string>,
    ]);
    setAddress(accounts.length > 0 ? accounts[0] : null);
    setOnCoti(chainId === COTI_CHAIN_ID);
  };

  useEffect(() => {
    refresh();
    const eth = window.ethereum;
    if (!eth) return;
    eth.on("accountsChanged", refresh);
    eth.on("chainChanged", refresh);
    return () => {
      eth.removeListener("accountsChanged", refresh);
      eth.removeListener("chainChanged", refresh);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    const eth = window.ethereum;
    if (!eth) { alert("Please install MetaMask"); return; }
    setConnecting(true);
    try {
      await eth.request({ method: "eth_requestAccounts" });
      await ensureCotiChain();
      await refresh();
    } catch {
      // user rejected
    } finally {
      setConnecting(false);
    }
  };

  if (address && onCoti) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#00ff88]" />
        <span className="text-sm font-mono text-zinc-300">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={connecting}
      className="text-sm font-bold px-4 py-2 rounded border border-zinc-600 hover:border-[#00ff88] hover:text-[#00ff88] transition-colors disabled:opacity-50"
    >
      {connecting ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}
