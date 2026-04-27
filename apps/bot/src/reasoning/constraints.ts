/**
 * Constraint extractor.
 *
 * For a correlation cluster, ask Gemini 2.5 Pro to enumerate logical
 * relationships between the markets (subset / implies / mutex / disjoint).
 * Constraints are the "physics" the arb engine then checks against live
 * CLOB prices. A violation on CLOB is money.
 *
 * Hallucination defences:
 *  1. Schema-enforced output (`responseSchema`): no free-form strings.
 *  2. Citations use market NUMBERS (1..N) we hand the model. We translate
 *     back to conditionIds ourselves — the model can't fabricate an ID.
 *  3. Every constraint must cite ≥ 2 distinct markets from the cluster;
 *     otherwise discarded.
 *  4. Bad constraints are harmless by construction: `arb.ts` does pure math
 *     on real bid/ask; a bogus logical claim with no numeric violation
 *     produces no proposal.
 *
 * In DEMO_MODE=replay we fall through to the hand-labelled fixture
 * constraint for deterministic demos.
 */
import type { Constraint } from "@autopilot/shared-types";
import { getFixtureKnownConstraint } from "../scanner/polymarket";
import type { ScanResult } from "../scanner/polymarket";
import { GoogleGenAI, Type } from "@google/genai";

const MODEL = "gemini-2.5-pro";
const MAX_CONSTRAINTS_PER_CLUSTER = 6;

const SYSTEM_PROMPT = `You extract logical constraints between prediction markets.

You receive a cluster of Polymarket binary markets (numbered 1..N with titles)
that share an underlying event. Your job: list the logical relationships that
MUST hold between their YES probabilities, regardless of what the market is
currently pricing.

Allowed relations:
- subset: outcome A is a strict subset of B. P(A) ≤ P(B). Example: "Trump wins
  PA" ⊂ "Trump wins the election".
- implies: A implies B in every world (same as subset for binary). P(A) ≤ P(B).
- mutex: A and B cannot both occur. P(A) + P(B) ≤ 1. Example: two different
  candidates winning the same single-winner race.
- disjoint: same meaning as mutex for this system; pick whichever is clearer.

Rules:
- Cite markets by their NUMBER (1..N). Do not invent numbers.
- Every constraint MUST reference at least 2 distinct markets.
- For "subset" and "implies": the FIRST market listed is the subset / implier;
  the SECOND is the superset / implied. Order matters.
- For "mutex" / "disjoint": order does not matter; list two markets.
- DO NOT output a constraint unless it is logically ironclad. If you're unsure
  whether A ⊂ B, skip it. False positives cost money; false negatives cost
  only a missed opportunity.
- Return at most 6 constraints. Prefer the strongest / most obvious.
- If no constraints hold, return an empty array. Better to stay silent than
  guess.

The "explanation" field should be one short sentence a human trader can verify
at a glance, e.g. "Trump winning PA requires Trump winning the election."`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ["constraints"],
  properties: {
    constraints: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["relation", "memberNumbers", "explanation"],
        properties: {
          relation: {
            type: Type.STRING,
            enum: ["subset", "implies", "mutex", "disjoint"],
          },
          memberNumbers: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: "1-based market numbers. For subset/implies, [subset, superset].",
          },
          explanation: {
            type: Type.STRING,
            description: "One-sentence human-verifiable justification.",
          },
        },
      },
    },
  },
};

type RawConstraint = {
  relation: "subset" | "implies" | "mutex" | "disjoint";
  memberNumbers: number[];
  explanation: string;
};
type RawResponse = { constraints: RawConstraint[] };

let clientCache: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (clientCache) return clientCache;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  clientCache = new GoogleGenAI({ apiKey: key });
  return clientCache;
}

export async function extractConstraints(cluster: ScanResult): Promise<Constraint[]> {
  // Fixture mode — use the hand-labelled constraint for reproducible demos.
  if (process.env.DEMO_MODE !== "live") {
    return extractFromFixture(cluster);
  }
  if (!process.env.GEMINI_API_KEY) return [];
  if (cluster.markets.length < 2) return [];

  const numbered = cluster.markets.map((m, i) => `${i + 1}. ${m.title}`).join("\n");

  let raw: RawResponse;
  try {
    const res = await withRetry(() =>
      client().models.generateContent({
        model: MODEL,
        contents: `Cluster "${cluster.cluster}":\n\n${numbered}`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    );
    raw = JSON.parse(res.text ?? '{"constraints":[]}') as RawResponse;
  } catch (err) {
    console.error("[constraints] Gemini call failed:", err instanceof Error ? err.message : err);
    return [];
  }

  const valid: Constraint[] = [];
  for (const c of (raw.constraints ?? []).slice(0, MAX_CONSTRAINTS_PER_CLUSTER)) {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const n of c.memberNumbers ?? []) {
      const idx = n - 1;
      if (idx < 0 || idx >= cluster.markets.length) continue;
      const id = cluster.markets[idx]!.conditionId;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length < 2) continue;
    valid.push({
      relation: c.relation,
      markets: ids,
      explanation: c.explanation || `${c.relation} over ${ids.length} markets`,
    });
  }
  return valid;
}

function extractFromFixture(cluster: ScanResult): Constraint[] {
  const known = getFixtureKnownConstraint();
  if (!known) return [];

  const clusterIds = new Set(cluster.markets.map((m) => m.conditionId));
  const allPresent = known.markets.every((id) => clusterIds.has(id));
  if (!allPresent) return [];

  return [
    {
      relation: known.relation as Constraint["relation"],
      markets: known.markets,
      explanation: known.explanation,
    },
  ];
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
      const backoff = Math.min(16_000, 1_500 * 2 ** i) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
