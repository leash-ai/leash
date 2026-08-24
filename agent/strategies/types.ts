/**
 * Shared strategy contract.
 *
 * The three strategies used to describe trade direction with two different
 * vocabularies — momentum and meanReversion in long/short, marketMaker in
 * buy/sell. Where a strategy is held as a union of the three, TypeScript
 * intersects the parameter types of executeTrade and lands on `never`, which is
 * why `ts-node agent.ts run` could not start. One vocabulary, one interface.
 */
import { PriceData } from "./momentum";

export type Side = "long" | "short";

export interface Trade {
  asset: string;
  side: Side;
  sizePercent: number;
  /** Optional human-readable signal, shown in agent logs. */
  reason?: string;
}

export interface Strategy {
  addPriceData(prices: PriceData): void;
  computeTrades(): Trade[];
  executeTrade(asset: string, side: Side, sizePercent: number, price: number): void;
  /**
   * @returns publicPnlBps — signed basis points, reported on-chain in the clear.
   *          gcEncoded     — publicPnlBps + PNL_OFFSET, the unsigned value that
   *                          gets encrypted for settlement. Must correspond to
   *                          the last publicPnlBps reported, or DuelManager's
   *                          in-circuit pin rejects the submission.
   */
  calculatePnLBps(prices: PriceData): { publicPnlBps: number; gcEncoded: number };
}
