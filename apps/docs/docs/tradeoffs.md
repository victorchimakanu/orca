---
sidebar_position: 11
title: Tradeoffs and What I Changed
---

# Tradeoffs and what I changed

<img src="/img/orca/killswitch.png" alt="Orca next to a kill switch" style={{display: "block", margin: "0 auto 1.5rem", maxWidth: "320px", borderRadius: "12px"}} />

A few decisions in this codebase look weird until you know the context. This page is the context.

## Replay mode is the default

The first instinct when showing this off is "show real numbers, real markets, real fills". Demo against live Polymarket, watch a real arb, watch a real fill, victory.

The reality is that a live demo is a coin flip. Polymarket's orderbook is mostly efficient. Most scan cycles produce zero proposals. When one does land, you are racing every other Polymarket bot in the world and you usually lose. You cannot ship a 90 second demo against a market that does not cooperate.

So the default is `DEMO_MODE=replay`. The fixture at [`apps/bot/src/scanner/fixtures/trump-pair.json`](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/scanner/fixtures/trump-pair.json) is a real Polymarket cluster format with a planted 100 bps subset violation. The pipeline is identical, only the source of `MarketSnapshot[]` is different.

What replay mode buys you.

- **Reproducibility.** The same demo runs on a plane.
- **Determinism.** The arb math output is fixed, you can write end to end tests against it.
- **No rate limits.** No Polymarket bans, no Gemini quota burn from repeat reasoning.
- **Cleaner debugging.** When something looks wrong, replay tells you instantly whether the bug is in your code or in the wire.

What you give up.

- **Real numbers.** The fill row says "dry hash", not a Polygonscan link.
- **The drama.** Watching the agent compete against other bots and lose is genuinely interesting, but it does not fit in a 60 second demo.

The trade off is right for a demo. It would be wrong for a production product.

## Live mode is where the system earns its keep

Once you have shipped the demo, flip `DEMO_MODE=live`. The exact same pipeline pulls real Polymarket clusters. The constraint extractor finds real subset relations between real markets. Most cycles produce zero proposals because the orderbook is mostly efficient. But the ones it finds are real.

If you want to feel the system work, run it for a full afternoon on live data with a tight `minEV` (say 0.5%) and read the reasoning log when a proposal fires. The "I just watched a bot reason about real markets" moment is the actual product.

## What I changed during the build

A short log of decisions that are not obvious from looking at the final state of the repo.

### Para to wagmi + MetaMask

The first plan was Para session signer, full stop. The session signer story is genuinely the right one for "agent runs while I sleep". Para's MPC enclave co signs inside a bounded envelope, the master key never moves, the user revokes with one click. That is the architecture you want.

In practice, Para's BETA environment refused my email auth code three times in a row. I needed forward motion, so I swapped the adapter to wagmi + the `injected()` connector, MetaMask popups every leg, hands on signing.

The aomi auth adapter contract made this swap a one file change. That is the lesson, the signer is supposed to be swappable. The repo still has the Para code path behind `NEXT_PUBLIC_PARA_API_KEY`, both flows work.

If you are building on aomi, write your auth adapter once, swap the underlying signer freely.

### Mock aomi backend instead of running a real one

The aomi React runtime expects a backend speaking a specific HTTP + SSE protocol. aomi-labs has not published the backend/runtime yet, so I wrote a 200 line shim at [`apps/mock-aomi/server.ts`](https://github.com/aomi-labs/orca/blob/main/apps/mock-aomi/server.ts) that serves the protocol locally and forwards the parts I care about (chat → policy parse, sign requests, sign responses) to my own bot.

This was the single most useful thing I did. It also revealed two places where the aomi runtime expectations did not match what I had built first.

1. **`/api/sessions` is overloaded.** Without query params it is "create or fetch session id" returning `{id}`. With `?public_key=…` it is "list threads" returning `[]`. The runtime's `for (const t of threadList)` crashes if you confuse the two. The shim now branches on the query param.
2. **The runtime does not poll until something says it should.** The session only starts polling `/api/state` when `is_processing: true` arrives in a state response. If the user connects their wallet AFTER the bot has begun emitting sign requests, the widget never sees them, because the runtime only fetches state once at thread mount. The shim fixes this by setting `is_processing: true` whenever a wallet is registered, which keeps the runtime polling continuously.

Both of these are small. Both took a while to find.

### `is_connected` and the bridge's wallet sync

The bot uses the connected wallet address as the EIP-712 `maker` field of the order. Without that, the widget's `signTypedData` call signs against a maker address that is not the actual signer, and Polymarket rejects it.

Solution, [`apps/web/components/wallet-sync.tsx`](https://github.com/aomi-labs/orca/blob/main/apps/web/components/wallet-sync.tsx). One `useEffect`, fires on wagmi `address` changes, POSTs `{address}` to the bot's `/wallet` endpoint. The bot uses that address as the maker the next time it builds an order.

It is one file. It is also the reason every leg in the dashboard's fills section has the right maker.

## Areas of the aomi docs I had to reverse engineer

A short list, in order of how much time I spent.

- **The auth adapter contract.** The shape `{identity, isReady, canConnect, canManageAccount, connect, manageAccount, switchChain, sendTransaction, signTypedData}` is the load bearing piece. It took reading the runtime source to find it.
- **The wallet event bus payload shape.** `WalletEip712Payload.typed_data` wraps `{domain, types, primaryType, message}`. The widget passes the full wrapper to the adapter, the adapter has to unwrap before forwarding to wagmi. Easy to miss.
- **The polling lifecycle.** Polling kicks off only when `is_processing: true` is observed in a state response. There is no "kick polling because user just connected" event. Once you know, you build around it.
- **The mock backend protocol.** No public reference for `/api/sessions`, `/api/state`, `/api/chat`, `/api/system`, `/api/updates`, `/api/events`. I derived it from the client source. The shim in `apps/mock-aomi` is the cleanest reference I have for someone else trying the same thing.

If you are reading this because you are about to do the same project, those four bullets will save you most of a day.

## What I would change with another week

- **Run a real aomi backend.** The shim is fine for one user on a laptop, but the real backend gets you thread persistence, model picker fan out, and presumably some auth. Gated on aomi-labs publishing the runtime.
- **Switch the default signer to Para.** Once Para's BETA env is reliable, the hands off session signer story is more compelling than MetaMask popups.
- **A proper "go live" wizard in the dashboard.** Today, going live is three env vars. It should be a button.
- **The aomi-transact skill instead of the in repo order builder.** Right now `packages/aomi-bridge` builds the CTF Exchange Order struct in TypeScript. Delegating to the skill gets you the approval choreography for free and removes ~150 lines of TS. Gated on aomi shipping the runtime/loader, the polymarket plugin in [`aomi-sdk`](https://github.com/aomi-labs/aomi-sdk/tree/main/apps/polymarket) is Rust source that needs a host process to load it. The bridge is shaped for the swap, see [Extending](./extending#plug-in-an-aomi-skill-when-the-runtime-ships).
- **A second venue.** Kalshi has a solid REST API, the same reasoning engine works. The market opens up dramatically the moment you can hedge across venues.
