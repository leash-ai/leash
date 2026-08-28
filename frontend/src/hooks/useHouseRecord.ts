"use client";

/**
 * How the six house bots are actually doing.
 *
 * The leaderboard ranks registered agents — the NFTs from the marketplace — and
 * the bots you build are not among them, nor are the ones you race. So the page
 * ranked a cast the product no longer puts on screen.
 *
 * This is the other half, and it needs nothing new on-chain. A resolved duel
 * already carries who played and who won, and which house bot took it is derived
 * from (duelId, startTime) — the same derivation the bot itself used. Scanning
 * gives every opponent a record without an event, an index or a redeploy.
 *
 * Duels the house did not play are skipped rather than counted as absences: two
 * humans facing each other is not a loss for anyone here.
 */
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { HOUSE_ROSTER, opponentFor } from "@/lib/houseRoster";

const ABI = [
  "function duelCount() view returns (uint256)",
  "function getDuel(uint256 duelId) view returns (address agentA, address agentB, uint256 stake, uint256 startTime, uint256 endTime, uint8 state, address winner, bool agentASubmitted, bool agentBSubmitted, uint256 createdAt)",
];

const HOUSE_ADDRESS = process.env.NEXT_PUBLIC_HOUSE_BOT_ADDRESS?.toLowerCase() ?? null;

/** Enough duels to be a record without walking the whole history every visit. */
const SCAN_DEPTH = 60;

export interface HouseRecord {
  name: string;
  style: string;
  wins: number;
  losses: number;
  fights: number;
}

export function useHouseRecord() {
  const [records, setRecords] = useState<HouseRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const address = process.env.NEXT_PUBLIC_DUEL_MANAGER_ADDRESS;
      if (!address || !HOUSE_ADDRESS) {
        setLoading(false);
        return;
      }

      try {
        const provider = new ethers.JsonRpcProvider(
          process.env.NEXT_PUBLIC_COTI_RPC || "https://testnet.coti.io/rpc",
        );
        const duels = new ethers.Contract(address, ABI, provider);

        const count = Number(await duels.duelCount());
        const first = Math.max(1, count - SCAN_DEPTH + 1);
        const ids = Array.from({ length: count - first + 1 }, (_, k) => first + k);

        // In batches, not all at once. Sixty concurrent getDuel calls at the
        // public COTI RPC leaves the page on "Reading duels…" indefinitely,
        // which looks like a broken hook rather than a throttled endpoint.
        const results: ({ id: number; d: unknown } | null)[] = [];
        for (let i = 0; i < ids.length; i += 10) {
          const batch = await Promise.all(
            ids.slice(i, i + 10).map((id) =>
              duels
                .getDuel(id)
                .then((d: unknown) => ({ id, d }))
                .catch(() => null),
            ),
          );
          if (cancelled) return;
          results.push(...batch);
        }

        const tally = new Map<string, HouseRecord>(
          HOUSE_ROSTER.map((b) => [b.name, { ...b, wins: 0, losses: 0, fights: 0 }]),
        );

        for (const row of results) {
          if (!row) continue;
          const d = row.d as {
            agentA: string;
            agentB: string;
            startTime: bigint;
            state: bigint;
            winner: string;
          };

          if (Number(d.state) !== 2) continue; // still running, nothing to record

          const played =
            d.agentA.toLowerCase() === HOUSE_ADDRESS ||
            d.agentB.toLowerCase() === HOUSE_ADDRESS;
          if (!played) continue;

          const bot = opponentFor(row.id, Number(d.startTime));
          if (!bot) continue;

          const entry = tally.get(bot.name);
          if (!entry) continue;

          // A no-contest resolves with no winner. It is not a loss and not a win;
          // counting it either way would invent a result nobody played for.
          if (d.winner === ethers.ZeroAddress) continue;

          entry.fights += 1;
          if (d.winner.toLowerCase() === HOUSE_ADDRESS) entry.wins += 1;
          else entry.losses += 1;
        }

        if (!cancelled) {
          setRecords(
            [...tally.values()].sort(
              (a, b) => b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name),
            ),
          );
        }
      } catch (e) {
        console.error("Failed to read house records:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { records, loading, scanDepth: SCAN_DEPTH };
}
