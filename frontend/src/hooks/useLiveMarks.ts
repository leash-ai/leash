"use client";

/**
 * The curve between transactions.
 *
 * A COTI block is about six seconds and every published score is a transaction,
 * so the on-chain history gains a point every few seconds at best — the curve
 * stepped, and no amount of speeding the agents up changed that, because the
 * chain was the floor.
 *
 * The agents know their own score continuously though: a portfolio and a current
 * price. They mark it four times a second over the same websocket the feed uses,
 * and this collects those into a series the chart can draw. Seeded with the
 * on-chain history so arriving mid-duel still shows the whole race.
 *
 * These are for watching, not for deciding. What settles is what each agent
 * published on-chain, pinned in-circuit by submitFinalPnL — a mark can never
 * change a result, and a dropped one costs a frame.
 */
import { useEffect, useRef, useState } from "react";
import { PnlPoint } from "./useDuelHistory";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || null;
const AGENT_WS = AGENT_URL ? AGENT_URL.replace(/^http/, "ws") : null;

/** Enough for a long duel at four marks a second without unbounded growth. */
const MAX_POINTS = 4000;

export function useLiveMarks(
  duelId: number,
  seed: PnlPoint[],
  startTime?: number,
): PnlPoint[] {
  const [points, setPoints] = useState<PnlPoint[]>([]);
  const latest = useRef<{ a: number | null; b: number | null }>({ a: null, b: null });
  const seeded = useRef(false);

  // The seed arrives asynchronously; take it once, then the live series owns the
  // curve. Re-seeding later would drop marks and make the line jump backwards.
  useEffect(() => {
    if (seeded.current || seed.length === 0) return;
    seeded.current = true;
    setPoints(seed);
    const last = seed[seed.length - 1];
    latest.current = { a: last.a, b: last.b };
  }, [seed]);

  useEffect(() => {
    if (!AGENT_WS || !startTime) return;

    let ws: WebSocket | undefined;
    let dead = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;

    const connect = () => {
      if (dead) return;
      try {
        ws = new WebSocket(`${AGENT_WS}/feed/${duelId}`);
        ws.onopen = () => { delay = 1000; };

        ws.onmessage = (e) => {
          let event: { type?: string; data?: { side?: "A" | "B"; pnlBps?: number } };
          try { event = JSON.parse(e.data); } catch { return; }
          if (event.type !== "mark" || typeof event.data?.pnlBps !== "number") return;

          if (event.data.side === "A") latest.current.a = event.data.pnlBps;
          else latest.current.b = event.data.pnlBps;

          const t = Math.max(0, Math.round(Date.now() / 1000 - startTime));
          setPoints((prev) => {
            const next = [...prev, { t, a: latest.current.a, b: latest.current.b }];
            return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
          });
        };

        ws.onclose = () => {
          if (dead) return;
          retry = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 10_000);
        };
        ws.onerror = () => { /* onclose follows */ };
      } catch {
        if (!dead) {
          retry = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 10_000);
        }
      }
    };

    connect();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [duelId, startTime]);

  return points;
}
