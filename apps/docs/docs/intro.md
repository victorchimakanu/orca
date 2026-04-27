---
slug: /
sidebar_position: 1
title: Introduction
---

# Orca

<img src="/img/orca/hero.png" alt="Orca" style={{display: "block", margin: "0 auto 1.5rem", maxWidth: "100%", borderRadius: "12px"}} />

<div style={{textAlign: "center", fontSize: "1.15rem", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 600, marginBottom: "0.5rem"}}>
Observe · Reason · Correlate · Act
</div>

<div style={{textAlign: "center", color: "var(--ifm-color-emphasis-700)", marginBottom: "1rem"}}>
Type one English sentence. A bot trades correlated Polymarket markets while you sleep. Your wallet signs. The bot only proposes.
</div>

<div style={{textAlign: "center", marginBottom: "2rem"}}>
<a href="https://youtu.be/b8aPweQHPL0"><b>▶ Watch the demo on YouTube</b></a>
</div>

:::tip Submission one pager
The one pager for this submission lives in the repo as **`How I Built Orca.md`** at the project root — the full build story, architecture decisions, and tradeoffs.
:::

## What Orca does

Polymarket lets you bet on real world events. Elections, sports, prices, anything with a yes or no answer.

Some bets are connected. "Trump wins Pennsylvania" can never be more likely than "Trump wins the election", because he has to win Pennsylvania to win the country. One price puts a ceiling on the other.

When the prices drift out of line, you can buy on one side and sell the other and lock in a profit no matter what happens. That gap is free money.

Spotting it by hand is exhausting. Orca watches the markets for you and acts the moment it sees one.

You give Orca one sentence:

```
"Watch Trump markets, fill arbs above 0.5% EV,
 books over 10k per side, max $50 per trade, cap $500."
```

The pipeline:

1. **Gemini turns the sentence into a typed `Policy` object.** No DSL. No YAML.
2. **The bot pulls a market cluster every 30 seconds.** Either from a fixture (replay mode) or from Polymarket's live feeds (live mode).
3. **A small LLM groups markets** that share an underlying event.
4. **A larger LLM lists the logical rules** between those markets.
5. **Plain math** checks the orderbook against each rule and sizes the trade.
6. **The bot asks your wallet to sign** the resulting order. Your wallet (MetaMask or a Para session signer) signs. The private key never leaves your wallet.
7. **Every fill, position, and PnL point** is saved in SQLite and streamed to the dashboard.

Every proposal lands in a live reasoning log. Accepted, rejected, and the rule that motivated it. You watch the bot think.

## Why this matters

Today, a retail Polymarket trader has three options.

1. **Re-price correlated markets by hand.** Doable. Exhausting. Low edge.
2. **Run a Python script you cannot fully audit.** Custodial. Fragile. Breaks at 3am.
3. **Hand the keys to a centralised hedge fund.** Custodial. Opaque. Not yours.

Orca is option 4. One sentence becomes a strategy that runs continuously. No keys handed over. No code written. No all night monitoring.

It compresses "I have an opinion about the market" → "the bot is trading my opinion" from a project to a sentence.

## Where to go next

- **[Quickstart](./quickstart)** — clone, run, paste a policy. Under five minutes.
- **[User flow](./user-flow)** — what the demo looks like in the browser, with screenshots.
- **[Going live](./going-live)** — swap the fixture for live Polymarket data and watch real fills.
- **[Built on aomi](./how-aomi-fits)** — the exact aomi pieces Orca uses.
- **[Architecture](./architecture)** — the full request path with every component named.
- **[Tradeoffs](./tradeoffs)** — what I changed while building this and why.
