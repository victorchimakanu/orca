---
sidebar_position: 5
title: How aomi fits
---

# How Orca uses aomi

<img src="/img/orca/scanner.png" alt="Orca circling a network of markets" style={{display: "block", margin: "0 auto 1.5rem", maxWidth: "320px", borderRadius: "12px"}} />

aomi is a wallet aware AI runtime. It gives you a chat surface, a wallet event bus, a session model, and a contract for how the agent asks the user's wallet to sign. Orca is what you build when you take that contract seriously and put a trading bot on the other side.

This page is the receipts version. Each aomi piece, what it does in this codebase, and which file you find it in.

## The aomi pieces, named

| Package | Where it shows up | What it does for Orca |
|---|---|---|
| [`@aomi-labs/widget-lib`](https://www.npmjs.com/package/@aomi-labs/widget-lib) | Installed via the shadcn registry into [apps/web/components/aomi-frame.tsx](https://github.com/aomi-labs/orca/blob/main/apps/web/components/aomi-frame.tsx) | Provides `<AomiFrame>`, the chat thread UI, the wallet pill, the control bar, and the `RuntimeTxHandler`. We hide the model picker, app picker, and secrets UI for the demo. |
| [`@aomi-labs/react`](https://www.npmjs.com/package/@aomi-labs/react) | [apps/web/lib/aomi-auth-adapter.ts](https://github.com/aomi-labs/orca/blob/main/apps/web/lib/aomi-auth-adapter.ts), [apps/web/components/runtime-tx-handler.tsx](https://github.com/aomi-labs/orca/blob/main/apps/web/components/runtime-tx-handler.tsx) | `AomiRuntimeProvider` wires the wallet request queue, the thread list, the SSE subscription, and the user state model. We hand it our wagmi backed auth adapter. |
| [`@aomi-labs/client`](https://www.npmjs.com/package/@aomi-labs/client) | Used internally by `@aomi-labs/react` | The HTTP + SSE client for the aomi backend protocol. We satisfy that protocol with our own bridge. |
| Aomi auth adapter contract | [apps/web/lib/aomi-auth-adapter.ts](https://github.com/aomi-labs/orca/blob/main/apps/web/lib/aomi-auth-adapter.ts) | The shape `{identity, isReady, canConnect, canManageAccount, connect, manageAccount, switchChain, sendTransaction, signTypedData}`. Implement it once with wagmi or Para and the widget routes through your wallet. |

The aomi runtime does not care which wallet you use. It cares that the adapter you give it can `connect`, can tell it the current `identity`, can `signTypedData`, and can `sendTransaction`. That contract is the load bearing piece.

## The non custodial boundary

The signing flow is the moment Orca stops being a chat app and becomes a trading agent. The aomi runtime gives us a clean event bus to draw the boundary on.

```
            ┌────────── apps/web (browser) ──────────┐
            │                                        │
 bot SSE    │  aomi runtime, queues pending requests │
   │        │           │                            │
   │        │           ▼                            │
   ├───────►│  RuntimeTxHandler picks the next req   │
wallet_     │           │                            │
eip712      │           ▼                            │
_request    │  AomiAuthAdapter.signTypedData(...)    │
            │           │                            │
            │           ▼                            │
            │  wagmi useSignTypedData → MetaMask /   │
            │  Para session signer co sign           │
            │           │                            │
            │  signature                             │
            │           │                            │
            │  POST /sign back to bot                │
            └────────────────────────────────────────┘
```

Three properties this boundary enforces:

- **The bot never imports a signing library.** It emits events. It never holds a key.
- **The runtime never builds a transaction.** It only relays the structured payload the bot chose to emit.
- **The adapter is swappable.** Para session signer for sleep mode. MetaMask for hands on. Hardware wallet via the same contract.

## The pieces of the widget we used

`<AomiFrame>` is a compound component. We mount it broken apart so the wallet button can sit in the dashboard header and the composer somewhere else.

```tsx
<AomiFrame.Root height="100%" showSidebar={false} walletPosition="header">
  <AomiFrame.Header
    withControl
    showSidebarTrigger={false}
    controlBarProps={{
      hideWallet: false,
      hideNetwork: false,
      hideModel: true,
      hideApp: true,
      hideApiKey: true,
      hideSecrets: true,
    }}
  />
  <AomiFrame.Composer />
</AomiFrame.Root>
```

We turned off the model picker, app picker, API key panel, and secrets panel because Orca only ever uses Gemini and only ever talks to one bot. Everything else stays on. We are not reskinning the widget — we are configuring it.

## The bridge to our bot

The aomi React runtime expects to talk to an aomi backend over a specific HTTP + SSE protocol (`/api/sessions`, `/api/state`, `/api/chat`, `/api/system`, `/api/updates`). aomi-labs has not published the backend/runtime yet, so we wrote a 200 line shim at [apps/mock-aomi/server.ts](https://github.com/aomi-labs/orca/blob/main/apps/mock-aomi/server.ts) that translates that protocol into our own `POST /policy`, `POST /sign`, and `GET /events` endpoints.

The shim does three jobs.

1. **Forward chat messages** to the bot's `POST /policy` so the user's English sentence gets parsed by Gemini and the bot starts scanning.
2. **Subscribe to the bot's SSE** and queue `wallet_eip712_request` and `wallet_tx_request` payloads under the runtime's `pending_eip712s` and `pending_txs` slots, so the runtime drains them and triggers the wallet popup.
3. **Relay signatures back** by translating `wallet_eip712_response` into a `POST /sign` on the bot.

Point `NEXT_PUBLIC_BACKEND_URL` at a real hosted aomi backend and the shim falls away. The architecture does not depend on it.

## Where the agent runs

A subtle point. The "agent" in Orca is not running inside the aomi widget. It is a separate process at `apps/bot` that uses Gemini directly via `@google/genai`. The widget is the user's wallet aware face on the system. It does not host the model.

This split was deliberate.

- **The bot needs to run continuously**, including overnight, including across browser refreshes. Putting Gemini calls inside the widget would tie the agent's lifetime to the tab.
- **The bot needs SQLite, file system, scheduled timers.** A browser tab cannot guarantee any of those.
- **The bot needs to be a single source of truth for caps.** Two browser tabs would each independently propose orders without seeing each other's deployed counter.

The widget is a viewer plus a wallet. The bot is the agent. The aomi runtime is the bridge.

## Reading list before you extend

If you are about to plug Orca into something else (Kalshi, a different chain, a different signer), read these files in order.

1. [apps/web/lib/aomi-auth-adapter.ts](https://github.com/aomi-labs/orca/blob/main/apps/web/lib/aomi-auth-adapter.ts) — the only piece that knows about your wallet.
2. [apps/web/components/runtime-tx-handler.tsx](https://github.com/aomi-labs/orca/blob/main/apps/web/components/runtime-tx-handler.tsx) — the only piece that pulls events off the runtime queue.
3. [apps/mock-aomi/server.ts](https://github.com/aomi-labs/orca/blob/main/apps/mock-aomi/server.ts) — the protocol shim. Replace it last when you go to a hosted aomi backend.
4. [apps/bot/src/index.ts](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/index.ts) — the bot's HTTP surface.

If you want to swap the venue (Polymarket → Kalshi), most of the work is in the bot's scanner and execution paths. The aomi pieces above stay unchanged. See [Extending](./extending).
