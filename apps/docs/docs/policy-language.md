---
sidebar_position: 9
title: Policy Language
---

# Policy language

There is no DSL. You write an English sentence, and [apps/bot/src/policy/parser.ts](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/policy/parser.ts) translates it to a structured `Policy`.

This page documents the fields the parser can extract and shows real examples of inputs mapped to outputs.

## Policy schema

```ts
type Policy = {
  id: string;
  rawText: string;                 // your exact sentence
  topics: string[];                // lowercase tags, e.g. ["trump", "election-2024"]
  minEV: number;                   // fraction, [0, 0.5]. 0.03 = 3%
  minLiquidityPerSide: number;     // USDC depth required per side
  maxPerTrade: number;             // USDC cap per fill
  maxTotal: number;                // cumulative USDC cap
  expiresAt: number;               // session window (ms timestamp)
  hardStops: string[];             // free form halt conditions
  createdAt: number;
};
```

## Fields the parser recognises

### Topics

Lowercase tags matching Polymarket categories. Examples. `trump`, `election-2024`, `sports`, `crypto`, `tennis`, `nba`. The parser returns 1 to 5 topics.

If you do not name topics, the scanner defaults to top volume active markets.

### `minEV`, minimum expected value edge

A decimal fraction. The parser recognises `"3%"`, `"0.03"`, `"3 percent"`, `"300 bps"`, `"30 basis points"`, and clamps to `[0, 0.5]`.

### `minLiquidityPerSide`

USDC depth required at or near the best bid/ask on both sides of a proposed arb. Default 10,000 if not specified. Critical for avoiding slippage on small markets.

### `maxPerTrade`

USDC cap per individual fill. If not specified but a total cap is given, the parser uses `maxTotal / 10` as a heuristic.

### `maxTotal`

Cumulative USDC cap. Once hit, the agent stops. Enforced in two places.

1. Client side in the bot (SQLite deployed counter).
2. MPC side in Para (session authorisation envelope).

Default 500 if not specified.

### `hardStops`

Free form halt conditions. Examples. `"pause if I lose 10%"`, `"halt after 24 hours"`. Up to 10 entries. Evaluated each cycle. If any fires, the agent halts.

## 15 worked examples

Each row is an English input and the key fields the parser produces.

| Input | `topics` | `minEV` | `maxPerTrade` | `maxTotal` |
|---|---|---|---|---|
| "watch trump markets, 3% EV, $50 per trade, $500 cap" | `[trump]` | 0.03 | 50 | 500 |
| "election markets, 2% minimum edge" | `[election-2024]` | 0.02 | 50 | 500 |
| "sports arbs > 1%" | `[sports]` | 0.01 | 50 | 500 |
| "crypto, 20 bps only" | `[crypto]` | 0.002 | 50 | 500 |
| "trump, pennsylvania, wisconsin, 3% arb, cap $2000" | `[trump, pennsylvania, wisconsin]` | 0.03 | 200 | 2000 |
| "watch everything trump, be conservative" | `[trump]` | 0.01 | 50 | 500 |
| "super safe, 5% only, $10 per trade" | `[]` | 0.05 | 10 | 500 |
| "pause if I lose 10%" | `[]` | 0.03 | 50 | 500 (hardStops: ["lose 10%"]) |
| "3 percent edge minimum" | `[]` | 0.03 | 50 | 500 |
| "best arbs only" | `[]` | 0.05 | 50 | 500 |
| "liquidity at least 50k per side" | `[]` | 0.03 | 50 | 500 (minLiquidityPerSide: 50000) |
| "trump markets, mostly" | `[trump]` | 0.03 | 50 | 500 |
| "cap total $100" | `[]` | 0.03 | 10 | 100 |
| "aggressive trump bot, $5000 total, $500 per trade" | `[trump]` | 0.03 | 500 | 5000 |
| "halt on drawdown > 10%, also if server time is after midnight UTC" | `[]` | 0.03 | 50 | 500 (hardStops: [...]) |

The parser's full 20 fixture test suite lives at [apps/bot/src/policy/fixtures.ts](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/policy/fixtures.ts).

## What the parser will not do

- **Invent numbers.** If you do not specify a cap, it uses a conservative default. It will not guess based on your vibes.
- **Interpret trading jargon as action.** "Go long Trump" has no effect. The parser maps to topics and caps, not directional bets.
- **Exceed the clamped range.** `minEV > 0.5` is truncated. Any numeric field with a missing or absurd value gets the safe default.
- **Fall back silently.** If Gemini fails after 7 retries, the `POST /policy` endpoint returns an error. The old policy remains active.
