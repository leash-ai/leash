/**
 * One place that turns a strategy name into a strategy.
 *
 * agent.ts inlined a ternary and the two listeners each had their own copy, one
 * of which lacked a return type — which let the union of the three strategies
 * intersect to `never` and needed an @ts-ignore to compile. Returning Strategy
 * here is what makes that suppression unnecessary anywhere.
 */
import { MomentumStrategy } from "./momentum";
import { MeanReversionStrategy } from "./meanReversion";
import { MarketMakerStrategy } from "./marketMaker";
import { Strategy } from "./types";

export type StrategyName = "momentum" | "meanReversion" | "marketMaker";

const DEFAULT_VIRTUAL_CAPITAL = 1000;

export function makeStrategy(name: string): Strategy {
  if (name === "meanReversion") return new MeanReversionStrategy();
  if (name === "marketMaker") return new MarketMakerStrategy();
  return new MomentumStrategy(DEFAULT_VIRTUAL_CAPITAL);
}
