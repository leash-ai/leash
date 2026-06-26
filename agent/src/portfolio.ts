export interface Position {
  qty: number;
  avgBuyPrice: number;
}

export interface Portfolio {
  startValueUSD: number;
  cashUSD: number;
  positions: Record<string, Position>;
}

export function createPortfolio(): Portfolio {
  return { startValueUSD: 10_000, cashUSD: 10_000, positions: {} };
}

export function getCurrentValue(portfolio: Portfolio, prices: Record<string, number>): number {
  let value = portfolio.cashUSD;
  for (const [sym, pos] of Object.entries(portfolio.positions)) {
    if (prices[sym]) value += pos.qty * prices[sym];
  }
  return value;
}

export function getPnLBps(portfolio: Portfolio, prices: Record<string, number>): number {
  const current = getCurrentValue(portfolio, prices);
  return Math.round((current / portfolio.startValueUSD - 1) * 10_000);
}

export function applyAction(
  portfolio: Portfolio,
  action: { type: "BUY" | "SELL" | "HOLD"; symbol?: string; pct?: number },
  prices: Record<string, number>
): string {
  if (action.type === "HOLD" || !action.symbol || !action.pct) return "HOLD";
  const sym = action.symbol.toUpperCase();
  const price = prices[sym];
  if (!price) return `HOLD — unknown ${sym}`;
  const pct = Math.min(100, Math.max(1, action.pct)) / 100;

  if (action.type === "BUY") {
    const spend = portfolio.cashUSD * pct;
    if (spend < 1) return "HOLD — no cash";
    const qty = spend / price;
    portfolio.cashUSD -= spend;
    const existing = portfolio.positions[sym];
    if (existing) {
      existing.avgBuyPrice =
        (existing.avgBuyPrice * existing.qty + price * qty) / (existing.qty + qty);
      existing.qty += qty;
    } else {
      portfolio.positions[sym] = { qty, avgBuyPrice: price };
    }
    return `BUY ${qty.toFixed(6)} ${sym} @ $${price.toFixed(0)} (${(pct * 100).toFixed(0)}% cash)`;
  } else {
    const pos = portfolio.positions[sym];
    if (!pos || pos.qty <= 0) return `HOLD — no ${sym}`;
    const sellQty = pos.qty * pct;
    portfolio.cashUSD += sellQty * price;
    pos.qty -= sellQty;
    if (pos.qty < 0.000001) delete portfolio.positions[sym];
    return `SELL ${sellQty.toFixed(6)} ${sym} @ $${price.toFixed(0)} (${(pct * 100).toFixed(0)}%)`;
  }
}

export function portfolioSummary(portfolio: Portfolio, prices: Record<string, number>): string {
  const total = getCurrentValue(portfolio, prices);
  const pnl = ((total / portfolio.startValueUSD - 1) * 100).toFixed(2);
  const positions = Object.entries(portfolio.positions)
    .map(([sym, pos]) => `${sym}:${pos.qty.toFixed(4)}`)
    .join(" ");
  return `$${total.toFixed(0)} (${pnl}%) | cash:$${portfolio.cashUSD.toFixed(0)} | ${positions || "no positions"}`;
}
