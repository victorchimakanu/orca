---
sidebar_position: 3
title: User Flow (Demo)
---

# The demo, end to end

This is the path a first time user takes. It runs against the bundled fixture, so it is reproducible offline and the orderbook is guaranteed to contain a 100 bps arb. No USDC is at risk.

For the same pipeline against the real Polymarket orderbook, see [Going live](./going-live).

## The three panes

The dashboard splits the screen into three columns. Each pane has one job.

<img src="/img/screens/full_dashboard.png" alt="Full dashboard with all three panes visible" style={{borderRadius: "8px", maxWidth: "100%", boxShadow: "0 4px 16px rgba(0,0,0,0.2)"}} />

### Left pane, the chat widget

<img src="/img/screens/chat_widget.png" alt="Chat widget on the left" style={{borderRadius: "8px", maxWidth: "100%", boxShadow: "0 4px 16px rgba(0,0,0,0.2)"}} />

This is `<AomiFrame>` from [`@aomi-labs/widget-lib`](https://www.npmjs.com/package/@aomi-labs/widget-lib). It owns three things.

1. **The chat composer.** Where you type the policy.
2. **The wallet pill.** Click *Connect Account* to bring up MetaMask or any injected wallet.
3. **The wallet event bus.** When the bot wants a signature, it emits an event. The aomi runtime queues it. Your wallet signs.

Type a policy. It hits the bot's `POST /policy` endpoint, gets parsed by Gemini in about a second, and the bot starts scanning.

### Middle pane, the dashboard

<img src="/img/screens/pnl_proposals_fills.png" alt="PnL, open proposals, and fills in the middle pane" style={{borderRadius: "8px", maxWidth: "100%", boxShadow: "0 4px 16px rgba(0,0,0,0.2)"}} />

The trader view. Fed by a single SSE connection to `GET /events`. No polling.

Top to bottom.

- **Deployed capital + PnL sparkline.** Total USDC at risk against `policy.maxTotal`. The bot recomputes the deployed counter from SQLite every cycle, so a stale dashboard cannot trick the cap.
- **Open proposals.** Anything emitted to the wallet bus but not yet signed. Click into a row to see the rule that motivated it.
- **Fills.** Newest first. Each row links to Polygonscan in live mode. In dry mode, the row shows a synthesised hash and a `dry` badge.
- **Positions.** Marked to market against the latest cached prices.
- **Kill switch.** Posts to `POST /kill`. Stops the scan loop and rejects every in flight signature. The button is intentionally large.

### Right pane, the reasoning log

<img src="/img/screens/reasoning_log.png" alt="Live reasoning log on the right" style={{borderRadius: "8px", maxWidth: "100%", boxShadow: "0 4px 16px rgba(0,0,0,0.2)"}} />

The audit trail. Every scan, cluster, rule, proposal, and rejection lands here in order. When the bot acts, you see why.

A typical replay cycle prints:

```
[scan] 3 markets pulled from fixture
[cluster] trump-2024-presidency, 3 members
[constraint] subset, P(Trump) ≤ P(Republican)
[arb-check] EV=100bps, size=$50
[proposal] arb-…, 2 legs, awaiting signature
[fill] leg 0 filled, hash=0xdry-…
[fill] leg 1 filled, hash=0xdry-…
[pnl] deployed=$50, unrealized=$0.50
```

When a proposal is rejected, the reason is in line with the trace: "Below minEV", "below minLiquidityPerSide", "would exceed maxTotal", "kill switch".

## The five second policy

In the chat composer, paste:

> *Watch Trump markets, fill arbs above 0.5% EV, max $50 per trade, cap $500 total.*

The widget posts to `apps/mock-aomi`, which forwards to `POST /policy` on the bot. Gemini 2.5 Pro parses it at `temperature: 0` against a strict schema. The reply lands in the chat as a parsed policy card.

```
topics: [trump]
minEV: 0.50%
minLiquidityPerSide: $10000
maxPerTrade: $50
maxTotal: $500
```

## The first arb, ~30 seconds in

The bot scans every `SCAN_INTERVAL_MS` (default 30s). On the first tick after your policy lands, it pulls the fixture cluster, asks Gemini Flash to group it, asks Gemini Pro for rules, and finds the planted 100 bps subset violation between "Trump wins 2024" and "A Republican wins 2024". It emits a `wallet_eip712_request` for each leg.

The widget picks up the request from the runtime queue. Your wallet pops up. The typed data is the Polymarket CTF Exchange `Order` struct. You sign.

```json
{
  "domain": {
    "name": "Polymarket CTF Exchange",
    "chainId": 137,
    "verifyingContract": "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E"
  },
  "primaryType": "Order",
  "message": {
    "salt": "…",
    "maker": "0xYOUR_ADDRESS",
    "signer": "0xYOUR_ADDRESS",
    "tokenId": "…",
    "makerAmount": "91743119",
    "takerAmount": "50000000",
    "side": 1,
    "signatureType": 0
  }
}
```

In `EXECUTION_MODE=dry` (the default), the bot does not submit the signature anywhere. It writes a synthesised fill to SQLite. In `EXECUTION_MODE=live`, it POSTs to `clob.polymarket.com/order` and the chain receives the order.

## The kill switch

`POST /kill` does three things, in order.

1. Sets `halted = true` on the bot.
2. Clears the scan interval.
3. Rejects every pending signature. Wallet popups already on screen will fail with `cancelled by kill switch`.

You can resume by posting a fresh policy. There is no `/resume` by design — if you halted, the policy probably needs reconsidering.

## What you've just done

In about ninety seconds you turned an English sentence into:

- a structured trading policy,
- a continuous scan against a fixture orderbook,
- an LLM rule extraction against a real Polymarket cluster format,
- a signed CTF Exchange order with a real EIP-712 domain,
- a fill, a position, a PnL point.

Every step was non custodial. The widget never sent your private key anywhere because it does not have it. Your wallet held the key. The bot only emitted the request. You decided.

Move on to [Going live](./going-live) when you want the same flow against the real Polymarket orderbook.
