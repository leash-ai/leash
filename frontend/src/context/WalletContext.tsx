"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

const COTI_TESTNET = {
  chainId: 7082400,
  chainIdHex: "0x6C11A0",
  name: "COTI Testnet",
  rpc: "https://testnet.coti.io/rpc",
  explorer: "https://testnet.cotiscan.io",
  currency: { name: "COTI", symbol: "COTI", decimals: 18 },
};

interface WalletState {
  isConnected: boolean;
  address: string | null;
  isLoading: boolean;
}

interface WalletContextType extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be inside WalletProvider");
  return ctx;
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    address: null,
    isLoading: false,
  });

  const switchToCotiNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: COTI_TESTNET.chainIdHex }],
      });
    } catch {
      // Any error: try adding the chain
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: COTI_TESTNET.chainIdHex,
          chainName: COTI_TESTNET.name,
          nativeCurrency: COTI_TESTNET.currency,
          rpcUrls: [COTI_TESTNET.rpc],
          blockExplorerUrls: [COTI_TESTNET.explorer],
        }],
      });
    }

    // Verify chain actually switched
    const currentChainId = (await window.ethereum.request({ method: "eth_chainId" })) as string;
    if (currentChainId.toLowerCase() !== COTI_TESTNET.chainIdHex.toLowerCase()) {
      throw new Error("Please switch to COTI Testnet in your wallet.");
    }
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert("No wallet detected. Please install MetaMask.");
      return;
    }
    setState((s) => ({ ...s, isLoading: true }));
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      await switchToCotiNetwork();

      // Small delay to let wallet settle after chain switch
      await new Promise((r) => setTimeout(r, 500));

      setState({ isConnected: true, address: accounts[0], isLoading: false });
    } catch (err: any) {
      console.error("Connect failed:", err);
      alert(err?.message || "Connection failed");
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, [switchToCotiNetwork]);

  const disconnect = useCallback(() => {
    setState({ isConnected: false, address: null, isLoading: false });
  }, []);

  // Restore session on mount
  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum.request({ method: "eth_accounts" }).then((res) => {
      const accounts = res as string[];
      if (accounts.length > 0) {
        window.ethereum!.request({ method: "eth_chainId" }).then((r) => {
          const chainId = r as string;
          if (chainId.toLowerCase() === COTI_TESTNET.chainIdHex.toLowerCase()) {
            setState({ isConnected: true, address: accounts[0], isLoading: false });
          }
        });
      }
    });

    const handleAccountsChanged = (...args: any[]) => {
      const accounts = args[0] as string[];
      if (accounts.length === 0) disconnect();
    };
    const handleChainChanged = () => window.location.reload();

    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum.on?.("chainChanged", handleChainChanged);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [disconnect]);

  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}
