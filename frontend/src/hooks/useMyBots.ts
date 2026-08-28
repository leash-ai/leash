"use client";

import { useCallback, useEffect, useState } from "react";

export interface Bot {
  id: string;
  name: string;
  /** The brief handed to the trading agent. Written by the model, not the user. */
  strategy: string;
  createdAt: number;
  /** Duels this bot has been sent into, so it can carry a record. */
  duelIds: number[];
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
      // duelIds arrived after the first bots did; treat its absence as empty
      // rather than letting every older bot render as undefined.
      if (raw) setBots((JSON.parse(raw) as Bot[]).map((b) => ({ ...b, duelIds: b.duelIds ?? [] })));
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
        duelIds: [],
      };
      persist([bot, ...bots]);
      return bot;
    },
    [bots, persist],
  );

  /** Remember that a bot was sent into a duel, so it can carry a record. */
  const recordDuel = useCallback(
    (id: string, duelId: number) =>
      persist(
        bots.map((b) =>
          b.id === id && !b.duelIds.includes(duelId)
            ? { ...b, duelIds: [...b.duelIds, duelId] }
            : b,
        ),
      ),
    [bots, persist],
  );

  const removeBot = useCallback(
    (id: string) => persist(bots.filter((b) => b.id !== id)),
    [bots, persist],
  );

  return { bots, addBot, removeBot, recordDuel, loaded };
}
