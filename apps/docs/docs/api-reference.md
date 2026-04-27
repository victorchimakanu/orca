---
sidebar_position: 10
title: API Reference
---

# API reference

The bot exposes a small HTTP and SSE surface on `BOT_HOST:BOT_PORT` (default `127.0.0.1:8787`).

Five endpoints, one SSE stream. If you need more than this, you are probably building something Orca is not.

## HTTP endpoints

### `GET /health`

Liveness and current mode info.

```json
{
  "ok": true,
  "demoMode": "replay",
  "executionMode": "dry",
  "halted": false,
  "deployedUsd": 0
}
```

### `GET /policy`

Returns the active policy and halted flag.

```json
{ "policy": { "id": "policy-…", "topics": ["trump"], "minEV": 0.03, … }, "halted": false }
```

### `POST /policy`

Parses an English policy via Gemini and activates it. Starts the scan loop if it was stopped.

```bash
curl -X POST http://127.0.0.1:8787/policy \
  -H 'content-type: application/json' \
  -d '{"rawText":"Watch Trump markets, 3% EV, $50 per trade, $500 cap."}'
```

On success, `{ "ok": true, "policy": {...} }`.
On parser failure, `{ "ok": false, "error": "..." }` with HTTP 500.

### `POST /kill`

Kill switch. Halts the scan loop and rejects every in flight signature promise.

```bash
curl -X POST http://127.0.0.1:8787/kill
```

Returns `{ "ok": true, "halted": true }`. No new proposals fire until a fresh policy is posted.

### `POST /sign`

Endpoint the widget's adapter POSTs to when it has a signed payload.

```json
{
  "id": "arb-…:0",
  "kind": "eip712",
  "signature": "0x…",
  "signerAddress": "0x…",
  "txHash": null
}
```

Validated against `SignedPayloadSchema`. Resolves the pending signature promise server side. Returns `{ ok: true }` on success, `{ ok: false, error: "..." }` with 404 if the id is unknown or expired.

### `POST /wallet`

Tells the bot which address is currently connected in the widget. The bot uses this as the EIP-712 `maker` field of every order it builds.

```json
{ "address": "0x…" }
```

Called by [apps/web/components/wallet-sync.tsx](https://github.com/aomi-labs/orca/blob/main/apps/web/components/wallet-sync.tsx) on every wagmi address change. Without this, the widget signs against a maker that is not the actual signer and Polymarket rejects.

### `GET /fills`

The 100 most recent fills from SQLite, newest first.

### `GET /positions`

Current positions derived from filled rows, marked to the latest market prices in memory.

### `GET /pnl`

The 200 most recent `PnlSnapshot` points (for sparklines).

## SSE stream

### `GET /events`

Server Sent Events stream. One connection delivers every event type. Each event is framed as `event: <type>\ndata: <json>\n\n`.

```ts
type BotEvent =
  | { type: "policy_parsed"; policy: Policy }
  | { type: "reasoning"; trace: ReasoningTrace }
  | { type: "proposal"; proposal: ArbProposal }
  | { type: "wallet_tx_request";    id: string; proposalId: string; legIndex: number; chainId: number; to: string; data: string; value: string }
  | { type: "wallet_eip712_request"; id: string; proposalId: string; legIndex: number; domain: unknown; types: unknown; message: unknown; primaryType: string }
  | { type: "fill"; fill: Fill }
  | { type: "position"; position: Position }
  | { type: "pnl"; snapshot: PnlSnapshot }
  | { type: "halt"; reason: string };
```

A `policy_parsed` event is emitted immediately on connect so late subscribers get the current state. A `ping` event is sent every 15s to keep the connection alive.

## Shared types

All types live in [`@autopilot/shared-types`](https://github.com/aomi-labs/orca/blob/main/packages/shared-types/src/index.ts) and are zod validated on both sides of the wire.

### `Policy`

```ts
{
  id: string;
  rawText: string;
  topics: string[];
  minEV: number;           // [0, 0.5]
  minLiquidityPerSide: number;
  maxPerTrade: number;
  maxTotal: number;
  expiresAt: number;
  hardStops: string[];
  createdAt: number;
}
```

### `Constraint`

```ts
{
  relation: "subset" | "disjoint" | "implies" | "mutex";
  markets: string[];   // conditionIds (order matters for subset/implies)
  explanation: string; // one sentence justification
}
```

### `ArbProposal`

```ts
{
  id: string;
  clusterLabel: string;
  constraint: Constraint;
  evBps: number;    // 100 = 1%
  sizeUsd: number;
  legs: Array<{
    conditionId: string;
    side: "YES" | "NO";
    action: "BUY" | "SELL";
    price: number;
    sizeUsd: number;
  }>;
  createdAt: number;
}
```

### `Fill`, `Position`, `PnlSnapshot`

See the [source](https://github.com/aomi-labs/orca/blob/main/packages/shared-types/src/index.ts) for the full zod schemas.
