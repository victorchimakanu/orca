---
sidebar_position: 3
title: Non Custodial Autopilot
---

# Non custodial autopilot

A bot that trades while you sleep has one classic failure mode. It needs your private key. That is where most autonomous trading systems quietly cease to be yours.

Orca does not cross that line. The bot can request signatures. It cannot produce them. The split is enforced by file boundary and language boundary, not just convention.

## The signer model, two paths

Orca was built around two signer paths and the codebase still supports both.

**Hands on, wagmi + injected (the default).** The widget connects MetaMask via wagmi. Each leg pops a real EIP-712 sign request. You inspect, you sign, the bot gets the signature. Good for demos. Painful for "agent runs while I sleep" because you sign every leg manually.

**Hands off, Para session signer.** You authorise a session envelope once (per trade cap, total cap, time window). Para's MPC enclave co signs inside that envelope without prompting. The master key never leaves the enclave. Outside the envelope (bigger trades, longer session, different session), Para refuses. Revocation is one click.

The Para path is where the system earns its keep. The wagmi path is what shipped first when Para's BETA env refused my email auth code three times in a row. Both paths are wired through the same aomi auth adapter contract. Swapping is a one file change.

## The event bus handoff

The non custodial boundary in this codebase is the wallet event bus exposed by the aomi widget.

```
            ┌──────────────────── web process ─────────────────────┐
            │                                                      │
   the bot      │   <AomiFrame/>                                       │
   (Bun)        │   ┌─────────────┐                                    │
     │          │   │ aomi widget │    aomi auth adapter               │
     │ SSE      │   │             │         │                          │
     ├─────────►│   │   ┌─────────┴───┐     │                          │
 wallet_eip712  │   │   │ event bus   │◄────┤                          │
 _request       │   │   └─────────┬───┘     │  signTypedData via       │
                │   │             │         │  wagmi or Para           │
                │   └─────────────┘         │                          │
                │                           ▼                          │
                │   POST /sign  ◄─────  SignedPayload                  │
                │       ▲                                              │
                └───────┼──────────────────────────────────────────────┘
                        │
                        ▼
               pending.resolve(payload)
                        │
                        ▼
         the bot submits signed order to CLOB
```

The bot never sees the private key. It emits a request, waits up to 60 seconds for a signed payload on `/sign`, then either submits (`EXECUTION_MODE=live`) or synthesises a fill (`EXECUTION_MODE=dry`).

## Cap enforcement, two layers

**Layer 1, client side, in the bot.**
Before emitting any sign request, [executeProposal](https://github.com/aomi-labs/orca/blob/main/apps/bot/src/execution/submit.ts) sums `deployedUsd()` from SQLite and rejects the proposal if `deployed + needed > policy.maxTotal`.

**Layer 2, MPC side, in Para.**
Even if the bot had a bug, the session envelope refuses to sign past the authorised total. Your key is safe even against a compromised bot.

Both layers exist because defence in depth is cheap when the layers are independent. Removing either one loses a property the other cannot recover.

## The kill switch

`POST /kill` does three things.

1. Sets the `halted` flag on the bot.
2. Clears the scan interval.
3. Rejects every in flight signature promise in `pending.ts`.

No new requests are emitted, and any mid flight requests return "cancelled" immediately. The dashboard reflects the state within one render cycle. The kill switch is a button in the dashboard header for a reason.
