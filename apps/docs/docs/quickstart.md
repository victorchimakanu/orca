---
sidebar_position: 2
title: Quickstart
---

# Quickstart

Under five minutes. No USDC required. The default config runs the full pipeline against a fixture, so the demo is reproducible offline.

## Prereqs

- Node 20 or newer
- pnpm 9 or newer
- Bun 1.1 or newer (`curl -fsSL https://bun.sh/install | bash`)
- A free Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

## Install

```bash
git clone <this-repo> orca
cd orca

pnpm install

cp .env.example .env
# open .env, paste your GEMINI_API_KEY
```

## Run

```bash
pnpm dev
```

Turbo boots four processes in parallel.

| Process | Port | What it does |
|---|---|---|
| `apps/bot` | `8787` | The bot. Scan loop, reasoning, execution, SSE, SQLite. |
| `apps/web` | `3000` | Dashboard and the aomi widget. |
| `apps/mock-aomi` | `8080` | A local stub for the aomi runtime so the widget renders without a hosted backend. |
| `apps/docs` | `3001` | This site. Optional. |

Open [http://localhost:3000](http://localhost:3000). You should see three columns: chat widget on the left, dashboard in the middle, reasoning log on the right.

<img src="/img/screens/full_dashboard.png" alt="Full dashboard view" style={{borderRadius: "8px", maxWidth: "100%", boxShadow: "0 4px 16px rgba(0,0,0,0.2)"}} />

## Paste a policy

Type this in the chat composer.

> *Watch Trump markets, fill arbs above 0.5% EV, max $50 per trade, cap $500 total.*

Within one scan cycle (≤30s), the reasoning log streams something like:

```
[cluster] scanned 1 cluster, 3 markets
[constraint] If Trump wins 2024, a Republican necessarily wins. P(Trump) ≤ P(Republican).
[proposal] ARB 1.00% EV, $50 size, 2 legs
[execution] executed 2 legs, deployed=$50
```

The dashboard middle column updates with the open proposal, then the fill, then the PnL.

## Verify the pipeline

```bash
# 20 policy fixtures against Gemini
pnpm --filter bot test:parser

# Offline full pipeline run, fixture in, proposal out
pnpm --filter bot replay

# Typecheck every package
pnpm typecheck
```

If `replay` prints a 100 bps proposal, the LLM chain, the arb math, and the execution path are all wired correctly.

## Next

- **[User flow](./user-flow)** — the same demo with screenshots.
- **[Going live](./going-live)** — swap the fixture for live Polymarket data.
