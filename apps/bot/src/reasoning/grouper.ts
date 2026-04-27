/**
 * Correlation grouper.
 *
 * Given the output of the scanner (one big cluster per topic in live mode, or
 * already-grouped in fixture mode), ask Gemini 2.5 Flash to subdivide markets
 * into correlation groups — sets of markets that share an underlying event and
 * can therefore have logical relationships (subset / mutex / implies) between
 * their prices.
 *
 * Output is re-projected back into `ScanResult[]` so the downstream constraint
 * extractor + arb math stay unchanged.
 *
 * Hallucination defence: the model returns titles; we map titles back to
 * conditionIds using the actual cluster, dropping anything we can't resolve.
 */
import type { MarketSnapshot } from "@autopilot/shared-types";
import type { ScanResult } from "../scanner/polymarket";
import { GoogleGenAI, Type } from "@google/genai";

const MODEL = "gemini-2.5-flash";
const MIN_CLUSTER_MARKETS = 2;
const MAX_MARKETS_PER_INPUT = 50;

const SYSTEM_PROMPT = `You are a prediction-market correlation analyst.

You receive a list of Polymarket binary markets (numbered 1..N with titles).
Group them into "correlation clusters" — sets of markets that share an
underlying event and therefore have logical relationships between their YES
probabilities.

Examples of clusterable relationships:
- "X wins PA" is a subset of "X wins the election" (subset relationship).
- "X wins" and "Y wins" where X and Y are mutually exclusive candidates (mutex).
- "X wins primary" implies "X on the ballot in November" (implies).

Rules:
- Each cluster must contain at least 2 markets. If a market has no clear
  relationship to any other, DO NOT include it in any cluster.
- Give each cluster a short, human-readable label (e.g. "2024 US presidential
  winner", "NBA Finals MVP").
- Use the provided market NUMBERS (1..N) to cite members. Do not invent titles.
- Clusters should be disjoint (a market appears in at most one cluster).
- Skip markets that are totally unrelated to anything else in the list.
- Prefer tight, correct clusters over sprawling, speculative ones. When in
  doubt, omit.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ["clusters"],
  properties: {
    clusters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["label", "memberNumbers"],
        properties: {
          label: { type: Type.STRING, description: "Short human-readable cluster name" },
          memberNumbers: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: "1-based market numbers belonging to this cluster",
          },
        },
      },
    },
  },
};

type RawCluster = { label: string; memberNumbers: number[] };
type RawResponse = { clusters: RawCluster[] };

let clientCache: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (clientCache) return clientCache;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  clientCache = new GoogleGenAI({ apiKey: key });
  return clientCache;
}

export async function groupByCorrelation(scans: ScanResult[]): Promise<ScanResult[]> {
  // In fixture mode (DEMO_MODE=replay) the scanner already returns a single
  // labelled cluster; skip the LLM call to stay deterministic.
  if (process.env.DEMO_MODE !== "live") return scans;
  if (!process.env.GEMINI_API_KEY) return scans;

  const out: ScanResult[] = [];
  for (const scan of scans) {
    if (scan.markets.length < MIN_CLUSTER_MARKETS) continue;
    const subdivided = await subdivide(scan);
    out.push(...subdivided);
  }
  return out;
}

async function subdivide(scan: ScanResult): Promise<ScanResult[]> {
  const markets = scan.markets.slice(0, MAX_MARKETS_PER_INPUT);
  const numbered = markets.map((m, i) => `${i + 1}. ${m.title}`).join("\n");

  let raw: RawResponse;
  try {
    const res = await withRetry(() =>
      client().models.generateContent({
        model: MODEL,
        contents: `Markets under parent cluster "${scan.cluster}":\n\n${numbered}`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    );
    raw = JSON.parse(res.text ?? '{"clusters":[]}') as RawResponse;
  } catch (err) {
    console.error("[grouper] Gemini call failed, skipping cluster:", err instanceof Error ? err.message : err);
    return [];
  }

  const results: ScanResult[] = [];
  for (const c of raw.clusters ?? []) {
    const members: MarketSnapshot[] = [];
    for (const n of c.memberNumbers ?? []) {
      const idx = n - 1;
      if (idx >= 0 && idx < markets.length) {
        members.push(markets[idx]!);
      }
    }
    if (members.length < MIN_CLUSTER_MARKETS) continue;
    results.push({ cluster: c.label || scan.cluster, markets: members });
  }
  return results;
}

export function marketMap(markets: MarketSnapshot[]): Map<string, MarketSnapshot> {
  return new Map(markets.map((m) => [m.conditionId, m]));
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /\b(503|502|500|429|UNAVAILABLE|RESOURCE_EXHAUSTED)\b/.test(msg);
      if (!retryable || i === attempts - 1) throw err;
      const backoff = Math.min(12_000, 1_000 * 2 ** i) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
