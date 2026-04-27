import type { Policy } from "@autopilot/shared-types";

/**
 * M1 default policy, used until M2 wires the Gemini parser.
 * Tuned to fire on the fixture constraint (EV ≈ 1%, plenty of liquidity).
 */
export function defaultPolicy(rawText = "Watch all Trump markets, min 0.5% EV, $50/trade, $500 cap."): Policy {
  return {
    id: `policy-${Date.now()}`,
    rawText,
    topics: ["trump", "election-2024"],
    minEV: 0.005,
    minLiquidityPerSide: 10_000,
    maxPerTrade: 50,
    maxTotal: 500,
    expiresAt: Date.now() + 4 * 60 * 60 * 1000,
    hardStops: [],
    createdAt: Date.now(),
  };
}
