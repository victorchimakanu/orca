/**
 * Live Polymarket scanner. Combines Gamma (market discovery) + CLOB (orderbooks)
 * into `MarketSnapshot[]`.
 *
 * Topics feed into the Gamma tag filter. Empty topics = scan the top volume
 * markets regardless of topic (useful for demos).
 *
 * In M3 we group into one big cluster called "mixed" and let the LLM grouper
 * subdivide. In a future iteration the cluster boundaries can be derived from
 * Gamma tags.
 */

import type { MarketSnapshot } from "@autopilot/shared-types";
import type { Policy } from "@autopilot/shared-types";
import { fetchMarketsByTopics, type GammaMarket } from "./gamma";
import { fetchOrderbook, topOfBook } from "./clob";
import type { ScanResult } from "./polymarket";

export async function scanLive(policy: Policy): Promise<ScanResult[]> {
  const now = Date.now();
  const gammaMarkets = await fetchMarketsByTopics(policy.topics);
  const usable = gammaMarkets.filter(
    (m) => m.enableOrderBook && !m.negRisk && m.liquidity >= policy.minLiquidityPerSide,
  );
  if (usable.length === 0) return [];

  // Limit to top 40 by volume to stay under rate limits + cap LLM token usage.
  const topN = usable.sort((a, b) => b.volume - a.volume).slice(0, 40);

  const snapshots: MarketSnapshot[] = [];
  for (const m of topN) {
    const yesToken = m.clobTokenIds[0];
    const noToken = m.clobTokenIds[1];
    if (!yesToken || !noToken) continue;
    try {
      const [yesBook, noBook] = await Promise.all([fetchOrderbook(yesToken), fetchOrderbook(noToken)]);
      const yes = topOfBook(yesBook);
      const no = topOfBook(noBook);
      snapshots.push({
        conditionId: m.conditionId,
        title: m.question,
        tags: m.tags,
        yesBestBid: yes.bestBid,
        yesBestAsk: yes.bestAsk,
        noBestBid: no.bestBid,
        noBestAsk: no.bestAsk,
        liquidityUsd: Math.min(yes.depthUsd, no.depthUsd, m.liquidity),
        updatedAt: now,
        yesTokenId: yesToken,
        noTokenId: noToken,
      });
    } catch (err) {
      // skip a market if its orderbook fetch fails; next cycle will retry
      continue;
    }
  }

  if (snapshots.length === 0) return [];

  const clusterLabel = policy.topics.length > 0 ? policy.topics.join("+") : "mixed";
  return [{ cluster: clusterLabel, markets: snapshots }];
}

export function gammaMarketSummary(markets: GammaMarket[]): string {
  return markets
    .slice(0, 10)
    .map((m) => `${m.question} [${m.tags.slice(0, 3).join(",") || "—"}]`)
    .join(" · ");
}
