/**
 * Mean Reversion Strategy
 * Buys assets that have dipped significantly below their recent average.
 * Sells assets that have risen significantly above their recent average.
 */

import { PriceData } from "./momentum";

export class MeanReversionStrategy {
  private priceHistory: PriceData[] = [];
  private positions: Array<{
    asset: string;
    side: "long" | "short";
    sizePercent: number;
    entryPrice: number;
    currentPrice: number;
  }> = [];

  /** Average over this many ticks. */
  private readonly WINDOW: number;
  /** How far from the average before acting. Low trades often on small
   *  dislocations; high waits for real ones and trades rarely. */
  private readonly THRESHOLD: number;

  constructor(window: number = 5, threshold: number = 0.02) {
    this.WINDOW = Math.max(2, window);
    this.THRESHOLD = threshold;
  }

  addPriceData(prices: PriceData) {
    this.priceHistory.push(prices);
    if (this.priceHistory.length > 20) {
      this.priceHistory = this.priceHistory.slice(-20);
    }
  }

  private average(asset: keyof Omit<PriceData, "timestamp">): number {
    const window = this.priceHistory.slice(-this.WINDOW);
    if (window.length === 0) return 0;
    return window.reduce((sum, p) => sum + p[asset], 0) / window.length;
  }

  computeTrades(): Array<{ asset: string; side: "long" | "short"; sizePercent: number }> {
    if (this.priceHistory.length < this.WINDOW) return [];

    const current = this.priceHistory[this.priceHistory.length - 1];
    const assets = ["BTC", "ETH", "SOL"] as const;
    const trades = [];

    for (const asset of assets) {
      const avg = this.average(asset);
      const deviation = (current[asset] - avg) / avg;

      // Buy dips: if price is 2% below average, go long
      if (deviation < -this.THRESHOLD) {
        trades.push({ asset, side: "long" as const, sizePercent: 50 });
      }
      // Sell pumps: if price is 2% above average, go short
      else if (deviation > this.THRESHOLD) {
        trades.push({ asset, side: "short" as const, sizePercent: 30 });
      }
    }

    return trades.slice(0, 2); // Max 2 positions
  }

  calculatePnLBps(currentPrices: PriceData): { publicPnlBps: number; pnlBpsExact: number; gcEncoded: number } {
    let totalPnl = 0;
    let allocatedPct = 0;

    for (const pos of this.positions) {
      const currentPrice = currentPrices[pos.asset as keyof PriceData] as number;
      const priceReturn = (currentPrice - pos.entryPrice) / pos.entryPrice;
      const positionReturn = pos.side === "long" ? priceReturn : -priceReturn;
      totalPnl += positionReturn * pos.sizePercent;
      allocatedPct += pos.sizePercent;
    }

    // Unrounded alongside the rounded value: the duel scores on a notional
    // position, so snapping to a whole basis point here made every published
    // score a multiple of the multiplier — a curve that climbed in 1.00% steps
    // and looked fabricated. Scale first, round once.
    const pnlBpsExact = totalPnl * 100;
    const pnlBps = Math.round(pnlBpsExact);
    const gcEncoded = pnlBps + 100_000_000;

    return { publicPnlBps: pnlBps, pnlBpsExact, gcEncoded };
  }

  executeTrade(asset: string, side: "long" | "short", sizePercent: number, price: number) {
    this.positions = this.positions.filter(p => p.asset !== asset);
    this.positions.push({ asset, side, sizePercent, entryPrice: price, currentPrice: price });
  }

  updatePositionPrices(prices: PriceData) {
    for (const pos of this.positions) {
      pos.currentPrice = prices[pos.asset as keyof PriceData] as number;
    }
  }

  getPositions() {
    return this.positions;
  }
}
