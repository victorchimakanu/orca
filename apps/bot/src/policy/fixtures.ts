/**
 * 20 policies spanning explicit, terse, ambiguous, adversarial, and edge cases.
 * Each fixture states the raw English + a partial expectation. The expectation
 * is intentionally forgiving: LLMs vary in word choices for `topics`, so we
 * assert structural properties (ranges, counts) rather than exact matches.
 */

export type PolicyFixture = {
  name: string;
  rawText: string;
  expect: {
    topicsIncludeAny?: string[];
    topicsCount?: { min?: number; max?: number };
    minEV?: { min?: number; max?: number };
    minLiquidityPerSide?: { min?: number; max?: number };
    maxPerTrade?: { min?: number; max?: number };
    maxTotal?: { min?: number; max?: number };
    hardStopsCount?: { min?: number; max?: number };
  };
};

export const POLICY_FIXTURES: PolicyFixture[] = [
  {
    name: "explicit-trump",
    rawText:
      "Watch Trump-related markets. Fill arbs > 3% EV with books > $10k liquidity on both sides, max $200/trade, cap $2000 total.",
    expect: {
      topicsIncludeAny: ["trump", "election", "politics", "us-politics", "election-2024"],
      minEV: { min: 0.029, max: 0.031 },
      minLiquidityPerSide: { min: 9000, max: 11000 },
      maxPerTrade: { min: 199, max: 201 },
      maxTotal: { min: 1999, max: 2001 },
    },
  },
  {
    name: "explicit-sports",
    rawText:
      "Watch all sports markets on Polymarket. Find arbs with at least 2% expected value, minimum $20000 depth on each side. Never put more than $75 into a single trade. Total capital at risk must never exceed $1500.",
    expect: {
      topicsIncludeAny: ["sports"],
      minEV: { min: 0.019, max: 0.021 },
      minLiquidityPerSide: { min: 19000, max: 21000 },
      maxPerTrade: { min: 74, max: 76 },
      maxTotal: { min: 1499, max: 1501 },
    },
  },
  {
    name: "terse-crypto",
    rawText: "btc markets, 1% arb, 50/trade, 500 cap",
    expect: {
      topicsIncludeAny: ["crypto", "bitcoin", "btc"],
      minEV: { min: 0.009, max: 0.011 },
      maxPerTrade: { min: 49, max: 51 },
      maxTotal: { min: 499, max: 501 },
    },
  },
  {
    name: "election-swing-states",
    rawText:
      "Only swing-state presidential markets. 4% minimum edge, deep liquidity only ($25k per side). $100 per fill, $1000 cap.",
    expect: {
      topicsIncludeAny: ["election", "politics", "swing-state", "swing-states", "us-politics", "election-2024"],
      minEV: { min: 0.039, max: 0.041 },
      minLiquidityPerSide: { min: 24000, max: 26000 },
      maxPerTrade: { min: 99, max: 101 },
      maxTotal: { min: 999, max: 1001 },
    },
  },
  {
    name: "no-limits-stated",
    rawText: "Arb any NFL playoff markets where the edge is over 5%.",
    expect: {
      topicsIncludeAny: ["sports", "nfl", "football"],
      minEV: { min: 0.049, max: 0.051 },
      minLiquidityPerSide: { min: 5000, max: 15000 },
      maxPerTrade: { min: 10, max: 200 },
      maxTotal: { min: 100, max: 1000 },
    },
  },
  {
    name: "very-small-cap",
    rawText: "Watch everything. Max $10 per trade, $30 cap total. I just want to see it work.",
    expect: {
      topicsCount: { min: 1, max: 5 },
      maxPerTrade: { min: 9, max: 11 },
      maxTotal: { min: 29, max: 31 },
    },
  },
  {
    name: "hard-stop-included",
    rawText:
      "Watch Bitcoin price markets, 2% EV minimum, $100/trade, $500 total. Pause if I lose 10% of deployed capital.",
    expect: {
      topicsIncludeAny: ["crypto", "bitcoin", "btc"],
      minEV: { min: 0.019, max: 0.021 },
      hardStopsCount: { min: 1, max: 3 },
    },
  },
  {
    name: "percent-as-percent-word",
    rawText: "Trump markets, three percent edge, 100 bucks per trade, 800 dollars total",
    expect: {
      topicsIncludeAny: ["trump", "politics", "election", "us-politics", "election-2024"],
      minEV: { min: 0.028, max: 0.032 },
      maxPerTrade: { min: 95, max: 105 },
      maxTotal: { min: 795, max: 805 },
    },
  },
  {
    name: "basis-points",
    rawText: "Watch election markets, 250 bps minimum edge, 50/trade, 500 cap",
    expect: {
      topicsIncludeAny: ["election", "politics", "us-politics", "election-2024"],
      minEV: { min: 0.024, max: 0.026 },
    },
  },
  {
    name: "superlative-only",
    rawText: "Find the juiciest arbs on Polymarket. Tight caps — $25/trade, $200 max.",
    expect: {
      maxPerTrade: { min: 24, max: 26 },
      maxTotal: { min: 199, max: 201 },
    },
  },
  {
    name: "explicit-liquidity-only",
    rawText: "Sports markets with deep books, at least $50k per side. 1% edge is fine.",
    expect: {
      topicsIncludeAny: ["sports"],
      minLiquidityPerSide: { min: 49000, max: 51000 },
      minEV: { min: 0.009, max: 0.011 },
    },
  },
  {
    name: "mixed-topics",
    rawText: "Trump AND crypto markets. 2% EV, $100/trade, $750 total.",
    expect: {
      topicsCount: { min: 2, max: 5 },
      minEV: { min: 0.019, max: 0.021 },
    },
  },
  {
    name: "upper-bound-safety",
    rawText: "Find any arb, any market. No limits. Just go.",
    expect: {
      minEV: { min: 0.0, max: 0.1 },
      maxPerTrade: { min: 1, max: 1000 },
      maxTotal: { min: 1, max: 10000 },
    },
  },
  {
    name: "aggressive-cap",
    rawText: "Election 2024 arbs, 1% edge, push hard — $500/trade, $5000 total.",
    expect: {
      topicsIncludeAny: ["election", "election-2024", "politics", "us-politics"],
      minEV: { min: 0.009, max: 0.011 },
      maxPerTrade: { min: 495, max: 505 },
      maxTotal: { min: 4995, max: 5005 },
    },
  },
  {
    name: "multiple-hard-stops",
    rawText:
      "Sports arbs, 2% EV, $100/trade, $1000 total. Pause if I lose 10%. Also stop if my wallet drops below $500.",
    expect: {
      topicsIncludeAny: ["sports"],
      hardStopsCount: { min: 2, max: 4 },
    },
  },
  {
    name: "single-sport-specific",
    rawText: "Soccer markets only. 3% edge. $50/trade. $400 cap.",
    expect: {
      topicsIncludeAny: ["sports", "soccer", "football"],
      minEV: { min: 0.029, max: 0.031 },
    },
  },
  {
    name: "scientific-notation",
    rawText: "Election arbs at 2.5% edge, $1e2 per trade, $1e3 cap.",
    expect: {
      minEV: { min: 0.024, max: 0.026 },
      maxPerTrade: { min: 99, max: 101 },
      maxTotal: { min: 999, max: 1001 },
    },
  },
  {
    name: "decimal-edge",
    rawText: "Trump markets, 1.5% edge, $50/trade, $500 cap",
    expect: {
      topicsIncludeAny: ["trump", "politics", "election", "us-politics", "election-2024"],
      minEV: { min: 0.014, max: 0.016 },
    },
  },
  {
    name: "dollar-signs-omitted",
    rawText: "sports, 2 percent, 100 per trade, 1000 cap",
    expect: {
      topicsIncludeAny: ["sports"],
      minEV: { min: 0.019, max: 0.021 },
      maxPerTrade: { min: 99, max: 101 },
      maxTotal: { min: 999, max: 1001 },
    },
  },
  {
    name: "conservative-default-inference",
    rawText: "Watch Elon Musk tweet-related markets.",
    expect: {
      topicsCount: { min: 1, max: 5 },
      minEV: { min: 0.0, max: 0.1 },
      maxTotal: { min: 100, max: 1000 },
    },
  },
];
