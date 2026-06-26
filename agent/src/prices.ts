const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  AVAX: "avalanche-2",
};

export interface Prices {
  [symbol: string]: number;
}

export async function fetchPrices(): Promise<Prices> {
  try {
    const ids = Object.values(COINGECKO_IDS).join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = (await res.json()) as any;
    const prices: Prices = {};
    for (const [sym, id] of Object.entries(COINGECKO_IDS)) {
      if (data[id]?.usd) prices[sym] = data[id].usd;
    }
    return prices;
  } catch (e) {
    console.warn("Price fetch failed, using fallback:", (e as Error).message);
    return { BTC: 97000, ETH: 3200, SOL: 145, BNB: 600, AVAX: 38 };
  }
}
