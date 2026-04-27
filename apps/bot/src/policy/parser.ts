import type { Policy } from "@autopilot/shared-types";
import { GoogleGenAI, Type } from "@google/genai";

const MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT = `You translate English trading policies into a strict JSON schema.

You are translating policies for an autonomous arbitrage agent that trades
correlated Polymarket prediction markets. Users type policies in English; you
map them to structured rules the agent enforces on every cycle.

Rules:
- "topics" should be lowercase tags matching Polymarket categories (e.g. "trump",
  "election-2024", "sports", "crypto"). Return 1-5 topics.
- "minEV" is a decimal fraction: 0.03 means 3%. Never a percent. Clamp to [0, 0.5].
- "minLiquidityPerSide" is the USDC depth required on each side of an arb. If the
  user didn't specify, use 10000.
- "maxPerTrade" is USDC per individual fill. If the user didn't specify but named
  a total cap, use maxTotal / 10.
- "maxTotal" is the cumulative USDC cap. If the user didn't specify, use 500.
- "hardStops" captures free-form halt conditions ("pause if I lose 10%").
  Leave empty if none mentioned.

Do not invent numbers. Prefer conservative defaults. If the user is ambiguous,
pick the SAFER interpretation (smaller size, tighter cap).`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ["topics", "minEV", "minLiquidityPerSide", "maxPerTrade", "maxTotal", "hardStops"],
  properties: {
    topics: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "1-5 lowercase Polymarket category tags",
    },
    minEV: {
      type: Type.NUMBER,
      description: "Minimum EV as fraction, e.g. 0.03 = 3%. Clamp [0, 0.5].",
    },
    minLiquidityPerSide: {
      type: Type.NUMBER,
      description: "Minimum USDC depth per orderbook side. Default 10000.",
    },
    maxPerTrade: {
      type: Type.NUMBER,
      description: "USDC cap per individual fill. Default maxTotal/10.",
    },
    maxTotal: {
      type: Type.NUMBER,
      description: "Cumulative USDC cap. Default 500.",
    },
    hardStops: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Free-form halt conditions, empty array if none.",
    },
  },
};

let clientCache: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (clientCache) return clientCache;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  clientCache = new GoogleGenAI({ apiKey: key });
  return clientCache;
}

export type ParsedFields = {
  topics: string[];
  minEV: number;
  minLiquidityPerSide: number;
  maxPerTrade: number;
  maxTotal: number;
  hardStops: string[];
};

export async function parsePolicy(rawText: string): Promise<Policy> {
  const ai = client();
  const response = await withRetry(() =>
    ai.models.generateContent({
      model: MODEL,
      contents: rawText,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  );

  const text = response.text ?? "";
  let parsed: ParsedFields;
  try {
    parsed = JSON.parse(text) as ParsedFields;
  } catch (err) {
    throw new Error(`Gemini returned non-JSON policy: ${text.slice(0, 200)}`);
  }

  const now = Date.now();
  const policy: Policy = {
    id: `policy-${now}`,
    rawText,
    topics: clampTopics(parsed.topics),
    minEV: clamp(parsed.minEV, 0, 0.5),
    minLiquidityPerSide: Math.max(0, Math.round(parsed.minLiquidityPerSide)),
    maxPerTrade: Math.max(0, Math.round(parsed.maxPerTrade)),
    maxTotal: Math.max(0, Math.round(parsed.maxTotal)),
    expiresAt: now + 4 * 60 * 60 * 1000,
    hardStops: (parsed.hardStops ?? []).map(String).slice(0, 10),
    createdAt: now,
  };

  if (policy.maxPerTrade > policy.maxTotal) policy.maxPerTrade = policy.maxTotal;
  return policy;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function clampTopics(topics: string[]): string[] {
  return (topics ?? [])
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean)
    .slice(0, 5);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 7): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Retry on transient 5xx and rate limits. Don't retry 4xx auth / schema errors.
      const retryable = /\b(503|502|500|429|UNAVAILABLE|RESOURCE_EXHAUSTED)\b/.test(msg);
      if (!retryable || i === attempts - 1) throw err;
      const jitter = Math.random() * 500;
      const backoff = Math.min(16_000, 1_000 * 2 ** i) + jitter;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
