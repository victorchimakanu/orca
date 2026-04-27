/**
 * Runs the Gemini policy parser against all 20 fixtures and prints a pass/fail
 * report. Requires GEMINI_API_KEY. Runs serially to stay under free-tier RPM.
 */

import { parsePolicy } from "../src/policy/parser";
import { POLICY_FIXTURES, type PolicyFixture } from "../src/policy/fixtures";

type Result = { name: string; ok: boolean; reasons: string[]; parsed?: unknown };

async function runOne(fx: PolicyFixture): Promise<Result> {
  const reasons: string[] = [];
  try {
    const parsed = await parsePolicy(fx.rawText);
    const e = fx.expect;

    if (e.topicsIncludeAny && e.topicsIncludeAny.length > 0) {
      const needle = e.topicsIncludeAny.some((want) => parsed.topics.some((got) => got.includes(want)));
      if (!needle) reasons.push(`topics missing any of [${e.topicsIncludeAny.join(", ")}], got [${parsed.topics.join(", ")}]`);
    }
    if (e.topicsCount) {
      if (e.topicsCount.min !== undefined && parsed.topics.length < e.topicsCount.min)
        reasons.push(`topics.length=${parsed.topics.length} < min=${e.topicsCount.min}`);
      if (e.topicsCount.max !== undefined && parsed.topics.length > e.topicsCount.max)
        reasons.push(`topics.length=${parsed.topics.length} > max=${e.topicsCount.max}`);
    }

    const rangeCheck = (label: string, got: number, range?: { min?: number; max?: number }) => {
      if (!range) return;
      if (range.min !== undefined && got < range.min) reasons.push(`${label}=${got} < min=${range.min}`);
      if (range.max !== undefined && got > range.max) reasons.push(`${label}=${got} > max=${range.max}`);
    };
    rangeCheck("minEV", parsed.minEV, e.minEV);
    rangeCheck("minLiquidityPerSide", parsed.minLiquidityPerSide, e.minLiquidityPerSide);
    rangeCheck("maxPerTrade", parsed.maxPerTrade, e.maxPerTrade);
    rangeCheck("maxTotal", parsed.maxTotal, e.maxTotal);
    if (e.hardStopsCount) {
      if (e.hardStopsCount.min !== undefined && parsed.hardStops.length < e.hardStopsCount.min)
        reasons.push(`hardStops.length=${parsed.hardStops.length} < min=${e.hardStopsCount.min}`);
      if (e.hardStopsCount.max !== undefined && parsed.hardStops.length > e.hardStopsCount.max)
        reasons.push(`hardStops.length=${parsed.hardStops.length} > max=${e.hardStopsCount.max}`);
    }

    return { name: fx.name, ok: reasons.length === 0, reasons, parsed };
  } catch (err) {
    reasons.push(`error: ${err instanceof Error ? err.message : String(err)}`);
    return { name: fx.name, ok: false, reasons };
  }
}

async function main() {
  console.log(`running ${POLICY_FIXTURES.length} policy fixtures against gemini-2.5-flash\n`);
  const results: Result[] = [];
  for (let i = 0; i < POLICY_FIXTURES.length; i++) {
    const fx = POLICY_FIXTURES[i]!;
    process.stdout.write(`[${i + 1}/${POLICY_FIXTURES.length}] ${fx.name}... `);
    const r = await runOne(fx);
    results.push(r);
    console.log(r.ok ? "PASS" : `FAIL (${r.reasons.length})`);
    if (!r.ok) {
      for (const reason of r.reasons) console.log(`    - ${reason}`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n─────────────`);
  console.log(`passed: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log(`failed: ${failed}`);
    process.exit(1);
  }
}

await main();
