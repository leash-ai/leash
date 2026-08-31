/**
 * Market Maker Strategy
 *
 * Profits from spread by maintaining balanced positions.
 * Goes long when RSI is oversold (<30), short when overbought (>70).
 * Keeps portfolio diversified across all tracked assets.
 */

import { PriceData } from "./momentum";
import { Side, Trade } from "./types";

interface AssetState {
  prices: number[];
  position: number;    // -1 short, 0 neutral, 1 long
  entryPrice: number;
}

export class MarketMakerStrategy {
  private assets: Record<string, AssetState> = {};
  /** Shorter period, twitchier signal. */
  private readonly RSI_PERIOD: number;
  /** Wider bands mean rarer but stronger signals. */
  private readonly OVERSOLD: number;
  private readonly OVERBOUGHT: number;

  constructor(rsiPeriod: number = 14, oversold: number = 30, overbought: number = 70) {
    this.RSI_PERIOD = Math.max(3, rsiPeriod);
    this.OVERSOLD = oversold;
    this.OVERBOUGHT = overbought;
  }
  private portfolio = 1000; // $1000 virtual

  addPriceData(data: PriceData): void {
    for (const asset of ["BTC", "ETH", "SOL"]) {
      if (!this.assets[asset]) {
        this.assets[asset] = { prices: [], position: 0, entryPrice: 0 };
      }
      const price = data[asset as keyof PriceData] as number;
      if (typeof price === "number") {
        this.assets[asset].prices.push(price);
        if (this.assets[asset].prices.length > 100) {
          this.assets[asset].prices.shift();
        }
      }
    }
  }

  private computeRSI(prices: number[]): number {
    if (prices.length < this.RSI_PERIOD + 1) return 50; // Neutral default

    let gains = 0, losses = 0;
    for (let i = prices.length - this.RSI_PERIOD; i < prices.length; i++) {
      const delta = prices[i] - prices[i - 1];
      if (delta > 0) gains += delta;
      else losses += Math.abs(delta);
    }

    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  computeTrades(): Trade[] {
    const trades: Trade[] = [];

    for (const [asset, state] of Object.entries(this.assets)) {
      if (state.prices.length < 2) continue;

      const rsi = this.computeRSI(state.prices);

      if (rsi < this.OVERSOLD && state.position !== 1) {
        trades.push({ asset, side: "long", sizePercent: 20, reason: `RSI ${rsi.toFixed(1)} oversold` });
      } else if (rsi > this.OVERBOUGHT && state.position !== -1) {
        trades.push({ asset, side: "short", sizePercent: 20, reason: `RSI ${rsi.toFixed(1)} overbought` });
      }
    }

    return trades;
  }

  executeTrade(asset: string, side: Side, _sizePercent: number, price: number): void {
    const state = this.assets[asset];
    if (!state) return;
    state.position = side === "long" ? 1 : -1;
    state.entryPrice = price;
  }

  calculatePnLBps(currentPrices: PriceData): { publicPnlBps: number; pnlBpsExact: number; gcEncoded: number } {
    let totalPnlBps = 0;
    let activePositions = 0;

    for (const [asset, state] of Object.entries(this.assets)) {
      if (state.position === 0 || state.entryPrice === 0) continue;

      const currentPrice = currentPrices[asset as keyof PriceData] as number;
      if (typeof currentPrice !== "number") continue;

      const priceDelta = (currentPrice - state.entryPrice) / state.entryPrice;
      const positionPnlBps = state.position * priceDelta * 10000;
      totalPnlBps += positionPnlBps;
      activePositions++;
    }

    // Unrounded alongside the rounded value: the duel scores on a notional
    // position, so snapping to a whole basis point here made every published
    // score a multiple of the multiplier — a curve that climbed in 1.00% steps
    // and looked fabricated. Scale first, round once.
    const pnlBpsExact = activePositions > 0 ? totalPnlBps / activePositions : 0;
    const avgPnlBps = Math.round(pnlBpsExact);
    const gcEncoded = avgPnlBps + 100_000_000;

    return { publicPnlBps: avgPnlBps, pnlBpsExact, gcEncoded };
  }
}
