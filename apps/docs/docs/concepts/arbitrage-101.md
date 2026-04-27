---
sidebar_position: 1
title: Arbitrage 101
---

# Arbitrage on Polymarket

Polymarket markets are binary. Each one pays out 1 USDC for YES if the event resolves true, 1 USDC for NO if false. Prices are probabilities between 0 and 1.

That property is the entire game. If two markets describe events with a fixed logical link (one implies the other, or they cannot both be true), then their prices are linked too. When the orderbook breaks the link, the gap is yours.

## The simplest arb, mutually exclusive outcomes

If two markets A and B cannot both resolve YES, then `P(A) + P(B) ≤ 1`.

So `1 − P(A)` (NO on A) and `1 − P(B)` (NO on B) must add up to at least 1.

If the orderbook prices `NO_ask(A) + NO_ask(B)` below 1, you can buy both NOs for less than 1 USDC and lock in 1 USDC back. Exactly one resolves YES, so exactly one of your NOs pays out. Risk free PnL.

**Concrete example.** "Trump wins 2024" and "Kamala Harris wins 2024" are mutually exclusive. If NO on Trump trades at 0.49 and NO on Harris trades at 0.48, you can buy both for 0.97 and guarantee 1.00 back. A 3 cent arb per dollar pair.

## Subset relationships

If event A implies event B (A ⊂ B), then `P(A) ≤ P(B)`.

"Trump wins Pennsylvania" implies "Trump wins the election", roughly. (Not strict — which is why the LLM is asked to be conservative.)

"A Republican wins 2024" is implied by "Trump wins 2024". Trump is a Republican. If he wins, a Republican wins.

When the orderbook breaks a subset rule — for example `YES_bid(Trump) > YES_ask(Republican)` — you can sell YES on Trump for more than you pay to buy YES on Republican. Since `P(Trump) ≤ P(Republican)` always, the short is hedged.

## Why these arbs exist

Polymarket is a CLOB with retail makers. Prices drift apart when:

- Attention flows unevenly across related markets. A poll moves the headline market without moving state markets.
- Liquidity is thin. One large order moves a single market without rippling.
- Traders model markets independently instead of jointly.
- Resolution details differ. "Wins" vs "takes office" vs "is inaugurated" can resolve differently.

None of these dry up. They get smaller as the field matures, but a bot running 24/7 can chip away. That is the entire premise.

## What we implement

[`apps/bot/src/reasoning/arb.ts`](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/reasoning/arb.ts) implements two pure math checks.

- `subset` and `implies`: `YES_bid(A) − YES_ask(B) > minEV`.
- `mutex` and `disjoint`: `1 − (NO_ask(A) + NO_ask(B)) > minEV`.

Size is the smaller of `policy.maxPerTrade` and 10% of the shallow side's depth (a crude Kelly cap). Cap enforcement against `policy.maxTotal` happens one layer up, in the executor.

The math is dumb on purpose. Smart math gives you false confidence about your model. Dumb math gives you a check that the orderbook contradicts a rule we already know is ironclad.
