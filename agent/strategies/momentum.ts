/**
 * Momentum Strategy
 * Buys assets that have risen over a lookback window.
 * Sells assets that have fallen.
 */

export interface Position {
  asset: string;
  side: "long" | "short";
  sizePercent: number; // 0-100% of virtual portfolio
  entryPrice: number;
  currentPrice: number;
}

export interface Portfolio {
  cashPercent: number;
  positions: Position[];
  virtualCapital: number;
}

export interface PriceData {
  BTC: number;
  ETH: number;
  SOL: number;
  timestamp: number;
}

export class MomentumStrategy {
  private portfolio: Portfolio;
  private priceHistory: PriceData[] = [];
  private readonly LOOKBACK = 3; // Look at last 3 price updates

  constructor(virtualCapital: number = 1000) {
    this.portfolio = {
      cashPercent: 100,
      positions: [],
      virtualCapital,
    };
  }

  addPriceData(prices: PriceData) {
    this.priceHistory.push(prices);
    if (this.priceHistory.length > 20) {
      this.priceHistory = this.priceHistory.slice(-20);
    }
  }

  /**
   * Compute momentum signals and decide trades.
   * Returns list of trades to execute.
   */
  computeTrades(): Array<{ asset: string; side: "long" | "short"; sizePercent: number }> {
    if (this.priceHistory.length < this.LOOKBACK) return [];

    const current = this.priceHistory[this.priceHistory.length - 1];
    const lookback = this.priceHistory[this.priceHistory.length - this.LOOKBACK];

    const assets = ["BTC", "ETH", "SOL"] as const;
    const signals: Array<{ asset: string; return: number }> = [];

    for (const asset of assets) {
      const ret = (current[asset] - lookback[asset]) / lookback[asset];
      signals.push({ asset, return: ret });
    }

    // Sort by return — strongest momentum first
    signals.sort((a, b) => b.return - a.return);

    const trades = [];

    // Go long on strongest positive momentum (>0.5%)
    if (signals[0].return > 0.005) {
      trades.push({
        asset: signals[0].asset,
        side: "long" as const,
        sizePercent: 60,
      });
    }

    // Go short on strongest negative momentum (<-0.5%)
    if (signals[signals.length - 1].return < -0.005) {
      trades.push({
        asset: signals[signals.length - 1].asset,
        side: "short" as const,
        sizePercent: 30,
      });
    }

    return trades;
  }

  /**
   * Calculate current PnL in basis points.
   * Returns value offset for GC: pnl_bps + 100_000_000
   */
  calculatePnLBps(currentPrices: PriceData): { publicPnlBps: number; gcEncoded: number } {
    let totalPnl = 0;
    let allocatedPct = 0;

    for (const pos of this.portfolio.positions) {
      const currentPrice = currentPrices[pos.asset as keyof PriceData] as number;
      const priceReturn = (currentPrice - pos.entryPrice) / pos.entryPrice;
      const positionReturn = pos.side === "long" ? priceReturn : -priceReturn;
      totalPnl += positionReturn * pos.sizePercent;
      allocatedPct += pos.sizePercent;
    }

    // Cash doesn't earn/lose
    const cashReturn = 0;
    totalPnl += cashReturn * (100 - allocatedPct);

    const pnlBps = Math.round(totalPnl * 100); // Convert to basis points
    const gcEncoded = pnlBps + 100_000_000; // Offset to ensure unsigned

    return { publicPnlBps: pnlBps, gcEncoded };
  }

  getPortfolio(): Portfolio {
    return this.portfolio;
  }

  updatePositionPrices(prices: PriceData) {
    for (const pos of this.portfolio.positions) {
      pos.currentPrice = prices[pos.asset as keyof PriceData] as number;
    }
  }

  executeTrade(asset: string, side: "long" | "short", sizePercent: number, price: number) {
    // Remove existing position in same asset if any
    this.portfolio.positions = this.portfolio.positions.filter(p => p.asset !== asset);

    this.portfolio.positions.push({
      asset,
      side,
      sizePercent,
      entryPrice: price,
      currentPrice: price,
    });

    this.portfolio.cashPercent = Math.max(0, 100 - this.portfolio.positions.reduce((s, p) => s + p.sizePercent, 0));
  }
}
