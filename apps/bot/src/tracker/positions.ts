/**
 * Derive positions + PnL from the fills table.
 *
 * This is intentionally recomputed on demand — fills table is small and
 * aggregation-driven bookkeeping is easier to reason about than transactional
 * position updates.
 */

import type { Position, PnlSnapshot, MarketSnapshot } from "@autopilot/shared-types";
import { listFills } from "./db";

type Agg = {
  conditionId: string;
  title: string;
  side: "YES" | "NO";
  grossUsd: number;     // sum of |BUY| - |SELL| size
  costUsd: number;      // weighted average tracking: sum of price * buySize - price * sellSize
  updatedAt: number;
};

export function currentPositions(latestPrices: Map<string, MarketSnapshot>): Position[] {
  const fills = listFills(1000).filter((f) => f.status === "filled");
  const byKey = new Map<string, Agg>();

  for (const f of fills) {
    const key = `${f.conditionId}:${f.side}`;
    const sign = f.action === "BUY" ? 1 : -1;
    const a = byKey.get(key) ?? {
      conditionId: f.conditionId,
      title: f.title,
      side: f.side,
      grossUsd: 0,
      costUsd: 0,
      updatedAt: 0,
    };
    a.grossUsd += sign * f.sizeUsd;
    a.costUsd += sign * f.sizeUsd; // USDC in/out at notional; price is implicit in size_usd at entry
    a.updatedAt = Math.max(a.updatedAt, f.at);
    byKey.set(key, a);
  }

  const positions: Position[] = [];
  for (const a of byKey.values()) {
    if (Math.abs(a.grossUsd) < 0.01) continue;
    const avgPrice = avgPriceFromFills(fills, a.conditionId, a.side);
    const market = latestPrices.get(a.conditionId);
    const lastPrice = markPrice(market, a.side);
    const unrealizedUsd = lastPrice === null ? 0 : (lastPrice - avgPrice) * (a.grossUsd / avgPrice);
    positions.push({
      conditionId: a.conditionId,
      title: a.title,
      side: a.side,
      netSizeUsd: a.grossUsd,
      avgPrice,
      lastPrice,
      unrealizedUsd,
      updatedAt: a.updatedAt,
    });
  }
  return positions;
}

function avgPriceFromFills(fills: ReturnType<typeof listFills>, conditionId: string, side: "YES" | "NO"): number {
  let sizeUsd = 0;
  let notionalShares = 0;
  for (const f of fills) {
    if (f.conditionId !== conditionId || f.side !== side) continue;
    if (f.status !== "filled") continue;
    const sign = f.action === "BUY" ? 1 : -1;
    sizeUsd += sign * f.sizeUsd;
    notionalShares += sign * (f.sizeUsd / f.price);
  }
  if (Math.abs(notionalShares) < 1e-9) return 0;
  return sizeUsd / notionalShares;
}

function markPrice(m: MarketSnapshot | undefined, side: "YES" | "NO"): number | null {
  if (!m) return null;
  if (side === "YES") {
    const mid = midOrNull(m.yesBestBid, m.yesBestAsk);
    return mid;
  }
  return midOrNull(m.noBestBid, m.noBestAsk);
}

function midOrNull(bid: number | null, ask: number | null): number | null {
  if (bid === null && ask === null) return null;
  if (bid === null) return ask;
  if (ask === null) return bid;
  return (bid + ask) / 2;
}

export function pnlSnapshot(positions: Position[], deployedUsd: number): PnlSnapshot {
  const unrealized = positions.reduce((n, p) => n + p.unrealizedUsd, 0);
  // Realized PnL tracking requires pairing opposing fills; we'll ship in M5.
  // For M4 we count only unrealized so the sparkline is honest.
  return {
    at: Date.now(),
    realizedUsd: 0,
    unrealizedUsd: unrealized,
    deployedUsd,
  };
}
