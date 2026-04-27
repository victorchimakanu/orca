---
sidebar_position: 7
title: Architecture
---

# Architecture

<img src="/img/orca/reasoning.png" alt="Orca and the data lines" style={{display: "block", margin: "0 auto 1.5rem", maxWidth: "320px", borderRadius: "12px"}} />

Three processes, one SSE stream, one SQLite database. No message broker. No cloud.

## The big diagram

```
                ┌───────────────────────────────────────────────────────────────┐
                │                          apps/web                              │
                │                       Next.js 15 (3000)                        │
                │                                                                │
   user types   │   ┌─────────────────┐    ┌─────────────────────────┐          │
   policy   ───►│   │  <AomiFrame>    │    │       Dashboard         │          │
                │   │  chat composer  │    │                         │          │
                │   │  wallet pill    │    │  • PnL sparkline        │          │
                │   │  ControlBar     │    │  • Open proposals       │          │
                │   └────────┬────────┘    │  • Fills (Polygonscan)  │          │
                │            │             │  • Positions (M2M)      │          │
                │            ▼             │  • Reasoning log        │          │
                │   ┌─────────────────┐    │  • Kill switch          │          │
                │   │  aomi runtime   │    └────────────▲────────────┘          │
                │   │  pending queue  │                 │                        │
                │   └────────┬────────┘                 │                        │
                │            │                          │                        │
                │            ▼                          │                        │
                │   ┌──────────────────────────┐       │ SSE                    │
                │   │  AomiAuthAdapter         │       │                        │
                │   │  (wagmi + injected)      │       │                        │
                │   └────────┬─────────────────┘       │                        │
                │            │                          │                        │
                │     MetaMask sign popup               │                        │
                │            │                          │                        │
                └────────────┼──────────────────────────┼────────────────────────┘
                             │                          │
                             │ POST /sign               │ GET /events
                             ▼                          │
            ┌──────────────────────────────────┐        │
            │       apps/mock-aomi (8080)      │        │
            │  shim that speaks aomi protocol  │        │
            │  on one side and bot HTTP on     │        │
            │  the other. Replace with hosted  │        │
            │  aomi backend in production.     │        │
            └──────────┬───────────────────────┘        │
                       │                                │
                       │ POST /sign                     │
                       ▼                                │
            ┌──────────────────────────────────────────┴───┐
            │                apps/bot (8787)                │
            │                  the bot                      │
            │                                                │
            │   ┌──────────────────────────────────────┐    │
            │   │  scan loop, every SCAN_INTERVAL_MS    │    │
            │   │                                       │    │
            │   │  1. Scanner                           │    │
            │   │     replay → fixture                  │    │
            │   │     live   → Gamma + CLOB             │    │
            │   │                                       │    │
            │   │  2. Grouper (Gemini 2.5 Flash)        │    │
            │   │     up to 50 markets → clusters       │    │
            │   │                                       │    │
            │   │  3. Constraints (Gemini 2.5 Pro)      │    │
            │   │     subset / mutex / implies / disjoint│    │
            │   │                                       │    │
            │   │  4. Arb math (pure)                    │    │
            │   │     EV check, Kelly bounded size       │    │
            │   │                                       │    │
            │   │  5. Cap enforcement (SQLite)           │    │
            │   │     deployedUsd() vs maxTotal          │    │
            │   │                                       │    │
            │   │  6. Execution                          │    │
            │   │     emit wallet_eip712_request         │    │
            │   │     await /sign within 60s             │    │
            │   │     submit to CLOB or synth fill       │    │
            │   │                                       │    │
            │   │  7. Tracker                            │    │
            │   │     fills → positions → PnL → SSE      │    │
            │   └──────────────────────────────────────┘    │
            │                                                │
            │   ./data/bot.db                                │
            │   policies, proposals, fills, positions,       │
            │   pnl_snapshots                                │
            └────────────────────────┬───────────────────────┘
                                     │
                                     ▼ EXECUTION_MODE=live only
                       ┌─────────────────────────┐
                       │  Polymarket CLOB        │
                       │  Polygon mainnet (137)  │
                       └─────────────────────────┘
```

## Data flow, one cycle

What happens between the user pasting a policy and the first fill landing in the dashboard, in order.

1. **User submits a policy** in the aomi widget chat composer.
2. Widget POSTs `/api/chat?message=…` to the mock aomi bridge.
3. Bridge forwards to `POST /policy` on the bot. Gemini 2.5 Pro parses against a strict `responseSchema`, returns a typed `Policy`. The bot stores it, sets `halted = false`, kicks the scan loop.
4. **Scan loop fires.** The bot pulls a `MarketSnapshot[]` from the fixture or from Gamma + CLOB.
5. **Grouper clusters markets** under shared events using Gemini 2.5 Flash.
6. **Constraint extractor** asks Gemini 2.5 Pro to list ironclad logical relations between markets in each cluster.
7. **Arb math** checks each constraint against the orderbook. If the EV beats `policy.minEV` and depth on both sides beats `policy.minLiquidityPerSide`, a proposal is built.
8. **Cap enforcement.** `deployedUsd()` is recomputed from SQLite. If `deployed + needed > policy.maxTotal`, the proposal is dropped. Reason logged.
9. **Execution.** The `aomi-bridge` package builds the CTF Exchange Order struct. The bot emits a `wallet_eip712_request` SSE event with the typed data.
10. The widget's runtime queue receives it via the bridge polling `/api/state` and translating `pending_eip712s` into `pendingWalletRequests`.
11. **`RuntimeTxHandler` picks the next request** off the queue and calls `adapter.signTypedData(payload)`.
12. The adapter calls `useSignTypedData` from wagmi. **MetaMask popup fires.** User signs.
13. The signed payload travels back through `POST /api/system` on the bridge, which forwards `POST /sign` to the bot.
14. The bot's pending signature promise resolves. In `live` mode, the signed order is submitted to `clob.polymarket.com`. In `dry` mode, a synthesised fill is written to SQLite.
15. **Fill row → position update → PnL snapshot.** All three published over SSE. Dashboard re-renders.

The whole cycle is typically under five seconds in replay mode and under ten seconds in live mode.

## Why three processes, not one

Each process has one job and one failure mode.

| Process | Owns | If it crashes |
|---|---|---|
| `apps/bot` | The agent loop, SQLite, capital, execution | The bot exits. Dashboard stops streaming. No money moves while it is down. Restart re-reads SQLite. |
| `apps/web` | The widget, the dashboard, the wallet adapter | Browser tab dies. The bot keeps trading on whatever signatures are already approved. Refresh restores the dashboard. |
| `apps/mock-aomi` | Protocol shim between widget and bot | The widget shows aomi runtime errors but the bot keeps running. The shim is stateless except for in flight sign requests, which the bot will time out on after 60s. |

Putting these in one process would mean a browser refresh kills the agent. We chose the harder path so the agent keeps trading.

## The non custodial property

The bot can request signatures. It can never produce them. The split is enforced by file boundary and language boundary, not just by convention.

- The bot (`apps/bot`) does not import `viem`, does not import any wagmi package, does not import any wallet SDK.
- The widget (`apps/web`) does not import any signing key. Wagmi delegates to the injected provider, which delegates to MetaMask, which delegates to the user.
- The bridge (`apps/mock-aomi`) only forwards messages. It does not see the user's key either.

The only place the user's key exists is inside the user's wallet (MetaMask process, hardware wallet, or Para's MPC enclave). Three processes, zero of them have access.

## SQLite schema

Five tables. `policies` (active and historical), `proposals` (every accepted and rejected, with reason), `fills` (one row per leg), `positions` (current per conditionId+side), `pnl_snapshots` (one per scan tick). Indexed on `created_at`. Querying for "everything that happened in the last hour" is one statement per table, no joins.

## What's intentionally absent

- **No message broker.** SSE is enough for one user. Adding RabbitMQ or NATS would buy us nothing.
- **No cache layer.** The 30s scan cadence is slow enough that re-fetching prices is fine. The grouper output is cached in memory until the market set changes.
- **No background queue.** The scan loop is a `setInterval`. Long term you might want a proper queue for retries. For one user with a 30 second cadence and idempotent reads, you do not.
- **No auth.** `/policy` and `/kill` are wide open. The deployment story is "run it on your laptop or behind Tailscale". See [Deployment](./deployment).
