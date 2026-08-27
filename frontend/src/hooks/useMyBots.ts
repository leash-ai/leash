"use client";

import { useCallback, useEffect, useState } from "react";

export interface Bot {
  id: string;
  name: string;
  /** The brief handed to the trading agent. Written by the model, not the user. */
  strategy: string;
  createdAt: number;
}

const KEY = "leash.bots.v1";

/**
 * The bots you have made, kept in this browser.
 *
 * Not on-chain on purpose. AgentRegistry can hold an agent as an NFT, but making
 * one costs gas and an MPC round before you have even picked a duel — a toll on
 * the first thing a new visitor does. A bot is a name and a paragraph; the duel
 * it plays is what goes on-chain.
 */
export function useMyBots() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setBots(JSON.parse(raw));
    } catch {
      // A corrupt entry should cost you your bots, not the page.
    }
    setLoaded(true);
  }, []);

  const persist = useCallback((next: Bot[]) => {
    setBots(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Private mode, quota — the bot still works for this session.
    }
  }, []);

  const addBot = useCallback(
    (name: string, strategy: string): Bot => {
      const bot: Bot = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        strategy,
        createdAt: Date.now(),
      };
      persist([bot, ...bots]);
      return bot;
    },
    [bots, persist],
  );

  const removeBot = useCallback(
    (id: string) => persist(bots.filter((b) => b.id !== id)),
    [bots, persist],
  );

  return { bots, addBot, removeBot, loaded };
}
