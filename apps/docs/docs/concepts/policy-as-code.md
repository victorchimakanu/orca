---
sidebar_position: 4
title: Policy as Code
---

# Policy as code

Most algo trading systems ask you to write code. This one asks you to write one English sentence.

The trick: we *translate* the sentence into a structured `Policy` object before anything runs. The bot is not interpreting your prose in a loop. It is running against a typed schema you can inspect.

## The round trip

```
English policy
    │
    ▼
Gemini 2.5 Pro (strict responseSchema, temperature 0)
    │
    ▼
Policy {
  topics: string[]
  minEV: number           // fraction, [0, 0.5]
  minLiquidityPerSide: number
  maxPerTrade: number
  maxTotal: number
  expiresAt: number       // session window
  hardStops: string[]
}
```

The parser at [apps/bot/src/policy/parser.ts](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/policy/parser.ts) is deterministic at `temperature: 0` and schema constrained. It cannot emit extra fields or malformed numbers. We validate the result with zod before saving.

## Conservative defaults

When a user says something ambiguous, the parser picks the **safer** interpretation. Smaller size, tighter cap, stricter liquidity floor. This is in the system prompt:

> *If the user is ambiguous, pick the SAFER interpretation (smaller size, tighter cap).*

| Input | Parser output (key fields) |
|---|---|
| "watch trump markets with 3% EV" | `minEV: 0.03`, `maxPerTrade: 50`, `maxTotal: 500` |
| "tense crypto, 20bps" | `minEV: 0.002`, `maxPerTrade: 50`, `maxTotal: 500` |
| "aggressive, $1000 total, $500 per trade" | `maxPerTrade: 500`, `maxTotal: 1000` |
| "$100 cap" | `maxTotal: 100`, `maxPerTrade: 10` |

If the parser fails (for example, persistent Gemini outages), the server returns 500 and the dashboard shows the error. It does not fall back to a loose default that could trade larger than intended. Silent fallbacks lose money. Loud failures do not.

## Every policy is a test case

The parser is covered by [20 fixtures](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/policy/fixtures.ts) covering different phrasings: explicit numbers, bps vs percent, no limits stated, upper bound safety, multiple hard stops, scientific notation. Run with:

```bash
pnpm --filter bot test:parser
```

The harness uses range assertions instead of exact match, so the test is robust to small LLM variance.

## What stays as prose

Two fields stay as English.

- `rawText`. Your exact sentence, kept for display and audit.
- `hardStops`. Free form halt conditions ("pause if I lose 10%").

The bot re-evaluates `hardStops` each cycle by asking Gemini whether any stop condition is met. This is the one place where prose survives into the live loop, and it is intentionally low stakes. `hardStops` can only halt the bot, not take actions.
