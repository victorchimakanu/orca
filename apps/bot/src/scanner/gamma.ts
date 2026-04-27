/**
 * Polymarket Gamma REST client.
 *
 * Discovers active binary markets filtered by policy topics. Output feeds into
 * the CLOB orderbook fetcher, then into the reasoning engine.
 */

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const MAX_MARKETS_PER_TOPIC = 60;

export type GammaMarket = {
  id: string;
  conditionId: string;
  question: string;
  description?: string;
  outcomes: string[];
  outcomePrices: string[];
  clobTokenIds: string[];
  tags: string[];
  liquidity: number;
  volume: number;
  endDate: string | null;
  enableOrderBook: boolean;
  negRisk: boolean;
};

type RawGammaMarket = {
  id: string | number;
  conditionId?: string;
  question?: string;
  description?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  clobTokenIds?: string | string[];
  tags?: Array<{ label?: string } | string> | string;
  liquidity?: string | number;
  volume?: string | number;
  endDate?: string;
  enableOrderBook?: boolean;
  negRisk?: boolean;
  active?: boolean;
  closed?: boolean;
};

export async function fetchMarketsByTopics(topics: string[]): Promise<GammaMarket[]> {
  const seen = new Map<string, GammaMarket>();
  const queries = topics.length > 0 ? topics : [""];

  for (const topic of queries) {
    const markets = await fetchTopic(topic);
    for (const m of markets) {
      if (!seen.has(m.conditionId)) seen.set(m.conditionId, m);
    }
  }

  return Array.from(seen.values());
}

async function fetchTopic(topic: string): Promise<GammaMarket[]> {
  const params = new URLSearchParams({
    limit: String(MAX_MARKETS_PER_TOPIC),
    active: "true",
    closed: "false",
    order: "volume",
    ascending: "false",
  });
  if (topic) params.set("tag", topic);

  const url = `${GAMMA_BASE}/markets?${params}`;
  const res = await fetch(url, {
    headers: { "user-agent": "orca/0.1 (+hackathon)" },
  });
  if (!res.ok) {
    throw new Error(`Gamma ${res.status} for topic=${topic}: ${await res.text().catch(() => "")}`);
  }

  const raw = (await res.json()) as RawGammaMarket[];
  return raw.flatMap((m) => normalize(m) ?? []);
}

function normalize(m: RawGammaMarket): GammaMarket | null {
  const conditionId = m.conditionId;
  const question = m.question;
  if (!conditionId || !question) return null;

  const outcomes = parseJsonArray(m.outcomes);
  const outcomePrices = parseJsonArray(m.outcomePrices);
  const clobTokenIds = parseJsonArray(m.clobTokenIds);

  // Binary-only for M3. Multi-outcome markets are handled via their underlying
  // binary event markets on Polymarket anyway.
  if (outcomes.length !== 2 || clobTokenIds.length !== 2) return null;

  const tags = parseTags(m.tags);

  return {
    id: String(m.id),
    conditionId,
    question,
    description: m.description,
    outcomes,
    outcomePrices,
    clobTokenIds,
    tags,
    liquidity: toNumber(m.liquidity),
    volume: toNumber(m.volume),
    endDate: m.endDate ?? null,
    enableOrderBook: m.enableOrderBook ?? true,
    negRisk: m.negRisk ?? false,
  };
}

function parseJsonArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseTags(value: Array<{ label?: string } | string> | string | undefined): string[] {
  if (!value) return [];
  if (typeof value === "string") return parseJsonArray(value);
  if (Array.isArray(value)) {
    return value
      .map((t) => (typeof t === "string" ? t : t?.label))
      .filter((t): t is string => !!t)
      .map((t) => t.toLowerCase());
  }
  return [];
}

function toNumber(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}
