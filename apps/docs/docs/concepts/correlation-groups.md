---
sidebar_position: 2
title: Correlation Groups
---

# Correlation groups

Arbitrage only works if two markets are provably related. Most Polymarket markets are unrelated. "Will Bitcoin hit $500k by 2026" and "Will West Ham be relegated" have no logical link.

The bot finds links in two steps. Step 1 is cheap and broad. Step 2 is precise and expensive. We pay for step 2 only on what survives step 1.

## Step 1, group markets under a shared event

The grouper at [apps/bot/src/reasoning/grouper.ts](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/reasoning/grouper.ts) takes a list of markets and asks Gemini 2.5 Flash to split them into clusters that share an underlying event.

- **Input.** Up to 50 numbered market titles.
- **Output.** `{ clusters: [{ label, memberNumbers: [int] }] }` via strict `responseSchema`.

Rules given to the model:

- A cluster must have at least 2 markets. Singletons are dropped.
- Clusters are disjoint. A market appears in at most one cluster.
- Unrelated markets are skipped, not jammed into a catch all group.
- When in doubt, omit. False positives cost downstream compute. False negatives cost a missed opportunity.

The model cites markets by their 1 based number. We map back to `conditionId` on our side. The model cannot fabricate a market that wasn't in the input.

## Step 2, extract logical rules per cluster

For each cluster, the constraint extractor at [apps/bot/src/reasoning/constraints.ts](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/reasoning/constraints.ts) asks Gemini 2.5 Pro to list the *ironclad* logical rules between the markets.

| Relation | Meaning | Math |
|---|---|---|
| `subset` | A is a strict subset of B | `P(A) ≤ P(B)` |
| `implies` | A logically implies B | `P(A) ≤ P(B)` |
| `mutex` | A and B cannot both occur | `P(A) + P(B) ≤ 1` |
| `disjoint` | Same as mutex | `P(A) + P(B) ≤ 1` |

The prompt is explicit: *false positives cost money, false negatives cost only a missed opportunity*. The model is told to return an empty array when uncertain.

## Hallucination defences

Three layers, all cheap.

1. **Schema enforced output.** The `responseSchema` forbids free form strings. Only structured JSON.
2. **Number based citation.** The model cites markets by 1 based number. We map to `conditionId`. It cannot invent a market.
3. **Pure downstream math.** A bogus rule with no numerical violation in the orderbook produces no proposal. Arb is always checked against real prices. The cost of a hallucinated rule is a few wasted tokens.

There is no fourth layer because the first three are enough. The bot cannot lose money on a false rule. It can only waste a scan cycle. That asymmetry is the only reason we trust an LLM with reasoning.
