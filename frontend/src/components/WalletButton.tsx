"use client";

import { useState, useEffect } from "react";

const COTI_CHAIN = {
  chainId: "0x6C0B20", // 7082400
  chainName: "COTI Testnet",
  nativeCurrency: { name: "COTI", symbol: "COTI", decimals: 18 },
  rpcUrls: ["https://testnet.coti.io/rpc"],
  blockExplorerUrls: ["https://explorer-devnet.coti.io"],
};

export function WalletButton() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [wrongChain, setWrongChain] = useState(false);

  const checkChain = async () => {
    const eth = window.ethereum;
    if (!eth) return;
    const chainId = (await eth.request({ method: "eth_chainId" })) as string;
    setWrongChain(chainId !== COTI_CHAIN.chainId);
  };

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;

    eth.request({ method: "eth_accounts" }).then((accounts: unknown) => {
      const list = accounts as string[];
      if (list.length > 0) {
        setAddress(list[0]);
        checkChain();
      }
    });

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAddress(accounts.length > 0 ? accounts[0] : null);
    };
    const onChainChanged = () => checkChain();

    eth.on("accountsChanged", onAccountsChanged);
    eth.on("chainChanged", onChainChanged);
    return () => {
      eth.removeListener("accountsChanged", onAccountsChanged);
      eth.removeListener("chainChanged", onChainChanged);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchToCoti = async () => {
    const eth = window.ethereum;
    if (!eth) return;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: COTI_CHAIN.chainId }],
      });
    } catch (err: any) {
      // 4902 = chain not added yet
      if (err.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [COTI_CHAIN],
        });
      }
    }
  };

  const connect = async () => {
    if (typeof window.ethereum === "undefined") {
      alert("Please install MetaMask");
      return;
    }
    setConnecting(true);
    try {
      const eth = window.ethereum!;
      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      setAddress(accounts[0]);
      await switchToCoti();
    } catch {
      // user rejected
    } finally {
      setConnecting(false);
    }
  };

  if (!address) {
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

  if (wrongChain) {
    return (
      <button
        onClick={switchToCoti}
        className="text-sm font-bold px-4 py-2 rounded border border-yellow-500 text-yellow-400 hover:bg-yellow-500/10 transition-colors"
      >
        Switch to COTI
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-[#00ff88]" />
      <span className="text-sm font-mono text-zinc-300">
        {address.slice(0, 6)}…{address.slice(-4)}
      </span>
    </div>
  );
}
