---
sidebar_position: 6
title: Extending Orca
---

# Extending Orca

The Orca codebase is small on purpose. Most of what looks like Orca specific code is actually generic infrastructure with a thin Polymarket layer on top. This page walks through the four extension paths that come up most often.

## Swap the venue (Polymarket → Kalshi, Manifold, ...)

The aomi side does not change. The bot side mostly does not change. What changes is the scanner and the execution adapter.

**What stays the same.**

- The policy parser, every field works against any binary prediction market.
- The grouper, it just needs market titles.
- The constraint extractor, same.
- The arb math in [`apps/bot/src/reasoning/arb.ts`](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/reasoning/arb.ts), it operates on bid/ask numbers, not Polymarket specifics.
- The dashboard, it consumes `Fill`, `Position`, `PnlSnapshot`, all venue agnostic.
- The signer path. If the new venue settles on a chain (or signs an EIP-712 order struct) supported by your aomi auth adapter, you reuse it.

**What you implement.**

1. **A scanner.** Hit the new venue's REST/WS API. Map their response into `MarketSnapshot[]`. Look at [`apps/bot/src/scanner/polymarket.ts`](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/scanner/polymarket.ts) for the shape.
2. **An execution adapter.** Compose whatever payload the new venue's clearing layer expects. For an EIP-712 venue you emit a `wallet_eip712_request` with the venue's domain. For an off chain API venue (Kalshi style with API keys) you skip the wallet event bus entirely and POST directly with a server held key, accepting that the venue is custodial.

If your new venue is non custodial and EIP-712 based, the path is essentially the same as Polymarket. If it is custodial, the trade off is yours, you give up the "your key signs" property in exchange for venue access.

## Swap the signer

The aomi auth adapter is a four function contract. Implement it, hand it to the runtime, done.

```ts
type AomiAuthAdapter = {
  identity: AomiAuthIdentity;
  isReady: boolean;
  canConnect: boolean;
  canManageAccount: boolean;
  connect: () => Promise<void>;
  manageAccount: () => Promise<void>;
  switchChain?: (chainId: number) => Promise<void>;
  sendTransaction?: (payload: WalletTxPayload) => Promise<{ txHash: string }>;
  signTypedData?: (payload: WalletEip712Payload) => Promise<{ signature: string }>;
};
```

We ship two adapters in this repo.

- **The current default**, wagmi + injected connector. Good for hands on demos. Every leg pops a MetaMask sign request. Source at [apps/web/lib/aomi-auth-adapter.ts](https://github.com/aomi-labs/orca/blob/main/apps/web/lib/aomi-auth-adapter.ts).
- **Para session signer.** Optional. Set `NEXT_PUBLIC_PARA_API_KEY` and the widget surfaces the Para login. The user authorises a session envelope once, the agent co signs inside it autonomously. This is the path you want for "agent runs while I sleep".

**Other signers people will want.**

- **Privy embedded wallet.** Same shape as Para. You wrap their SDK in the adapter contract.
- **Hardware wallet via WalletConnect.** Already works through the wagmi adapter if you swap `injected()` for `walletConnect(...)`. No code changes elsewhere.
- **Account abstraction with a session key.** Build a 7702 or 4337 session key, sign through the bundler, return the signature.

## Swap the model

The bot uses Gemini directly via `@google/genai`. Three calls.

| Call | Model | Where |
|---|---|---|
| Policy parse | Gemini 2.5 Pro, `temperature: 0`, strict `responseSchema` | [apps/bot/src/policy/parser.ts](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/policy/parser.ts) |
| Cluster grouping | Gemini 2.5 Flash | [apps/bot/src/reasoning/grouper.ts](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/reasoning/grouper.ts) |
| Constraint extraction | Gemini 2.5 Pro | [apps/bot/src/reasoning/constraints.ts](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/reasoning/constraints.ts) |

To swap, replace the three call sites with your provider's structured output equivalent. Anthropic's Claude has tool use, OpenAI has structured outputs, both work. Keep `temperature` low and the `responseSchema` strict. The arb math downstream is pure, so a model swap cannot move money on its own, the worst case is wasted scan cycles.

You can also keep Gemini and just route through aomi's model picker by setting `hideModel: false` on the control bar. That gives the user a dropdown in the widget to pick the chat model. We hid it because Orca's chat is just for policy submission and Gemini is good enough.

## Plug in an aomi skill (when the runtime ships)

### What the order build path looks like today

The bot builds Polymarket orders in TypeScript inside [`packages/aomi-bridge/src/index.ts`](https://github.com/aomi-labs/orca/blob/main/packages/aomi-bridge/src/index.ts). About 150 lines. It produces a real CTF Exchange EIP-712 Order struct (chainId 137, contract `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E`, EOA signature type) and hands it to `executeProposal`. This is the working path. Live mode submits the signed result to `clob.polymarket.com/order` and the order fills.

### Why we did not call the aomi skill instead

The plan was to call the `aomi-transact` skill and let aomi's Polymarket plugin produce the EIP-712 payload. The plugin already exists. It lives in [`aomi-sdk/apps/polymarket`](https://github.com/aomi-labs/aomi-sdk/tree/main/apps/polymarket) as a Rust crate that compiles to a dynamic library.

The blocker is the runtime. aomi-sdk's README is explicit, "It intentionally excludes the runtime / loader implementation." A `.dylib` cannot run alone, something has to host it, expose a tool calling interface, and translate to and from JSON. That host (the aomi runtime) has not been published yet. `gemini-cli` skills are markdown `SKILL.md` files, not plugin loaders, so they are not a substitute.

So the swap is gated on aomi shipping the runtime. Not on us writing more code.

### What the swap will look like when the runtime ships

The bridge has one public function, `buildPolymarketOrder(proposal, legIndex, ctx)`. When the runtime is available, that function calls into the runtime instead of building the struct in TypeScript. Same return shape, same call site, same downstream code.

```ts
// today
const req = await buildPolymarketOrder(proposal, i, { maker, tokenId });

// future, when the runtime is reachable
const req = await aomiTransact("polymarket.placeLimitOrder", { proposal, legIndex: i, maker, tokenId });
```

The bridge's job is to keep the call site stable across that transition.

### What the swap buys you

- **Approval choreography for free.** First fill on a fresh wallet needs `USDC.approve` and `CTF.setApprovalForAll`. The skill emits those as `wallet_tx_request` events automatically. Today the bot assumes those have already been done out of band.
- **Multi venue from one place.** When the skill grows a Kalshi or Manifold plugin, you flip a config flag instead of rewriting the bridge.
- **Less TS in the bot.** ~150 lines become a single skill call.

## Custom dashboard

The dashboard is a one connection SSE consumer. If you want a different UI, replace `apps/web` with anything that reads `GET /events` and POSTs to `/policy`, `/sign`, `/kill`. The bot does not care. Mobile, terminal, Slack bot, whatever.

We kept ours in Next.js because the aomi widget already hosts in React, and rebuilding the chat surface from scratch was not the interesting part of this project.

## What is intentionally not extensible

A few things in Orca are deliberately rigid.

- **The single user assumption.** The bot owns one SQLite DB, one pending signatures map, one policy. Multi user requires per tenant isolation everywhere. Fork and rebuild, do not bolt it on.
- **The cap enforcement layering.** Caps are checked in the bot AND inside the Para session envelope. If you remove either layer, you lose a defence in depth property. Add new caps, do not relax existing ones.
- **The reasoning log.** Every proposal accepted or rejected is logged. If you find yourself adding a "skip log for this case" branch, you are about to make the agent feel less trustworthy. Don't.
