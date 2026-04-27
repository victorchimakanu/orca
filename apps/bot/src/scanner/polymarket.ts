import type { MarketSnapshot, Policy } from "@autopilot/shared-types";
import fixture from "./fixtures/trump-pair.json" with { type: "json" };
import { scanLive } from "./live";

export type ScanResult = {
  cluster: string;
  markets: MarketSnapshot[];
};

/**
 * Dispatch between live Polymarket (Gamma + CLOB) and the fixture used for
 * reproducible demos. Flip via DEMO_MODE in .env.
 */
export async function scan(policy: Policy): Promise<ScanResult[]> {
  const mode = process.env.DEMO_MODE ?? "replay";
  if (mode === "live") return scanLive(policy);
  return scanFixture();
}

function scanFixture(): ScanResult[] {
  const now = Date.now();
  return [
    {
      cluster: fixture.cluster,
      markets: fixture.markets.map((m) => ({
        conditionId: m.conditionId,
        title: m.title,
        tags: m.tags,
        yesBestBid: m.yesBestBid,
        yesBestAsk: m.yesBestAsk,
        noBestBid: m.noBestBid,
        noBestAsk: m.noBestAsk,
        liquidityUsd: m.liquidityUsd,
        updatedAt: now,
        yesTokenId: (m as { yesTokenId?: string }).yesTokenId,
        noTokenId: (m as { noTokenId?: string }).noTokenId,
      })),
    },
  ];
}

export function getFixtureKnownConstraint() {
  return fixture.knownConstraint;
}
