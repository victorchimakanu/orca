import type { ArbProposal, Constraint, MarketSnapshot, Policy } from "@autopilot/shared-types";

/**
 * Pure arb math. Given a logical constraint over markets + their current
 * orderbook, determine whether prices violate the constraint and by how much.
 *
 * Supported relations (M1):
 *   - subset:  P(A) ≤ P(B).  Arb: YES on A is overpriced vs YES on B, or NO on B is overpriced vs NO on A.
 *   - disjoint/mutex: P(A) + P(B) ≤ 1. Arb: prices sum over 1, buy NO on both (sum of NOs > 1 by EV).
 *   - implies: same as subset — "A implies B" means P(A) ≤ P(B).
 *
 * Returns a proposal if violation exceeds `policy.minEV`, else null.
 */
export function evaluateConstraint(
  constraint: Constraint,
  markets: Map<string, MarketSnapshot>,
  policy: Policy,
): ArbProposal | null {
  const now = Date.now();

  if (constraint.relation === "subset" || constraint.relation === "implies") {
    const [aId, bId] = constraint.markets;
    if (!aId || !bId) return null;
    const a = markets.get(aId);
    const b = markets.get(bId);
    if (!a || !b) return null;

    // P(A) ≤ P(B). If YES-ask on A is lower than YES-bid on B, we'd love that,
    // but that's not an arb — prices are consistent. Arb exists when A's YES
    // ask > B's YES bid (buying A's YES while selling B's YES) is NOT the
    // violation; the actual violation is: market prices A higher than B.
    // Concretely: YES-bid(A) > YES-ask(B) means we can sell A-YES for more
    // than we pay to buy B-YES, and since P(A) ≤ P(B) any resolution leaves
    // us ahead.
    if (a.yesBestBid === null || b.yesBestAsk === null) return null;
    const spread = a.yesBestBid - b.yesBestAsk;
    if (spread <= policy.minEV) return null;

    const sizeUsd = Math.min(
      policy.maxPerTrade,
      policy.maxTotal,
      effectiveLiquidity(a.liquidityUsd, b.liquidityUsd, policy.minLiquidityPerSide),
    );
    if (sizeUsd <= 0) return null;

    return {
      id: `arb-${now}-${aId.slice(-6)}-${bId.slice(-6)}`,
      clusterLabel: constraint.explanation,
      constraint,
      evBps: Math.round(spread * 10_000),
      sizeUsd,
      legs: [
        {
          conditionId: aId,
          side: "YES",
          action: "SELL",
          price: a.yesBestBid,
          sizeUsd,
        },
        {
          conditionId: bId,
          side: "YES",
          action: "BUY",
          price: b.yesBestAsk,
          sizeUsd,
        },
      ],
      createdAt: now,
    };
  }

  if (constraint.relation === "mutex" || constraint.relation === "disjoint") {
    const [aId, bId] = constraint.markets;
    if (!aId || !bId) return null;
    const a = markets.get(aId);
    const b = markets.get(bId);
    if (!a || !b) return null;

    // P(A) + P(B) ≤ 1 (mutually exclusive). Arb if NO-ask(A) + NO-ask(B) < 1
    // by `minEV`: buy NO on both, guaranteed payout of 1 minus total cost.
    if (a.noBestAsk === null || b.noBestAsk === null) return null;
    const totalCost = a.noBestAsk + b.noBestAsk;
    const ev = 1 - totalCost;
    if (ev <= policy.minEV) return null;

    const sizeUsd = Math.min(
      policy.maxPerTrade,
      policy.maxTotal,
      effectiveLiquidity(a.liquidityUsd, b.liquidityUsd, policy.minLiquidityPerSide),
    );
    if (sizeUsd <= 0) return null;

    return {
      id: `arb-${now}-${aId.slice(-6)}-${bId.slice(-6)}`,
      clusterLabel: constraint.explanation,
      constraint,
      evBps: Math.round(ev * 10_000),
      sizeUsd,
      legs: [
        { conditionId: aId, side: "NO", action: "BUY", price: a.noBestAsk, sizeUsd: sizeUsd / 2 },
        { conditionId: bId, side: "NO", action: "BUY", price: b.noBestAsk, sizeUsd: sizeUsd / 2 },
      ],
      createdAt: now,
    };
  }

  return null;
}

function effectiveLiquidity(a: number, b: number, minPerSide: number): number {
  const worst = Math.min(a, b);
  if (worst < minPerSide) return 0;
  // Very rough cap: never take more than 10% of the shallow side.
  return worst * 0.1;
}
