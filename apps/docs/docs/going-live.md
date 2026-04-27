---
sidebar_position: 4
title: Going Live
---

# Going live

<img src="/img/orca/vault.png" alt="Orca over a vault" style={{display: "block", margin: "0 auto 1.5rem", maxWidth: "320px", borderRadius: "12px"}} />

The default config is intentionally cowardly. `DEMO_MODE=replay`, `EXECUTION_MODE=dry`, fixture in, dry fill out. No USDC moves. No chain calls. No way to lose money.

That is the right default, but it is not the point. Here is how to flip each switch.

## Three switches

There are exactly three env vars between the demo and a $1 USDC order on Polygon mainnet. Flip them in this order. Each step is independently reversible.

### 1. Live market data

```bash
DEMO_MODE=live pnpm dev
```

Now the bot hits Polymarket's [Gamma REST](https://gamma-api.polymarket.com) for metadata and [CLOB REST](https://clob.polymarket.com) for live orderbooks instead of the fixture. The reasoning log shows real conditionIds and real prices. Still no money at risk — execution is still in dry mode.

What changes:

- Gamma is polled every five minutes with a 60 second cache by conditionId.
- Up to 40 markets matching `policy.topics` get pulled per cycle.
- Most of the time, the live orderbook does not have a violation that beats your `minEV`. The reasoning log fills with rejected proposals. That is the expected steady state.

### 2. Real signing

This depends on which signer you use. Orca ships two paths.

**MetaMask (or any injected EVM wallet).**

```bash
NEXT_PUBLIC_SIGNER_MODE=live pnpm dev
```

Click *Connect Account* in the widget. Each arb leg pops a real EIP-712 signature request in MetaMask. You inspect, you sign, the bot gets the signature.

**Para session signer.**

Set the three Para vars in `.env`.

```dotenv
NEXT_PUBLIC_SIGNER_MODE=live
NEXT_PUBLIC_PARA_API_KEY=beta_…
NEXT_PUBLIC_PARA_ENV=BETA
```

The widget shows a *Connect with Para* button. Para creates an MPC backed wallet with no seed phrase. You authorise a session envelope (per trade cap, total cap, time window). The bot co signs inside that envelope without prompting you for every leg.

The session envelope is the killer feature. It is the difference between "I have to be at my laptop watching popups" and "I sleep, the bot trades, the cap protects me".

### 3. Real execution

```bash
DEMO_MODE=live EXECUTION_MODE=live NEXT_PUBLIC_SIGNER_MODE=live pnpm dev
```

Signed orders get POSTed to `clob.polymarket.com/order`. Fills are real. Positions are real. PnL is real. Mistakes cost real USDC.

## Funding the wallet

Send the connected address ~$2 USDC on Polygon.

- ~$1 covers the one off CTF Exchange + USDC approval transactions. After the first run, those are cached on chain.
- ~$1 covers the trade. Keep `policy.maxTotal` set to `1` for the first run. Watch one tiny order go through end to end before turning the caps up.

Polymarket has no meaningful testnet. All live testing is on mainnet. Treat the first $1 as the cost of confirming your wiring.

## What the first live fill looks like

1. Policy posts. Reasoning log streams scan → cluster → constraint as before.
2. The orderbook violation passes `minEV` and `minLiquidityPerSide`. A proposal lands.
3. The bot computes Kelly bounded size, clipped to `policy.maxPerTrade`, then double clipped to `policy.maxTotal − deployedUsd()`.
4. Signature requests fire, one per leg, in serial.
5. You sign in your wallet (or Para co signs silently inside the envelope).
6. Each signed payload is POSTed to Polymarket's CLOB. The fill confirms in a few hundred milliseconds.
7. The fill row links to a Polygonscan tx. The position appears, marked to market on the next snapshot tick.

If a leg fails on submission (rate limit, stale price, out of funds), the proposal is marked `partial` and the executor cancels in flight legs to avoid one sided exposure.

## Caps in two places

If you trust the bot, the bot's local cap check is enough. If you don't (and you shouldn't), the Para session envelope is a hard ceiling enforced in the MPC enclave. Even a bug in the bot cannot sign past the authorised total.

That is the point of running on a session signer instead of pasting a private key into a `.env` file.

## What can go wrong

- **Polymarket rate limits.** The grouper and constraint extractor retry on 429/503 with exponential backoff. If you blow past the limit, the loop pauses and resumes itself. Replay mode is your "Polymarket banned my IP" fallback.
- **Gemini quota.** Free tier is 15 requests per minute on Flash, 2 on Pro. One running instance fits comfortably. Two on the same key throttle Pro.
- **Stale prices.** The CLOB moves between scan and submission. Slippage protection lives in the order's `price` field. If the book moved, the order rejects. The bot logs it and tries again next tick.
- **Wallet on the wrong chain.** The widget triggers `wallet_switchEthereumChain` to Polygon (137) before signing. If MetaMask refuses, the request rejects. Switch and re-paste the policy.

## When in doubt, replay

If anything feels off in live mode, set `DEMO_MODE=replay` and re-run the scenario against the fixture. The fixture has a known 100 bps arb. If replay fails, the bug is in your code or env. If replay works and live does not, the bug is in the live data or the network path. This binary is the most useful debugging tool in the system.

## Operational rule of thumb

Run the bot on a machine you own (Mac mini, Pi 5, an old laptop) and tunnel the dashboard to your phone via Tailscale. Do not host this for other users. The architecture has zero tenant isolation by design — see [Deployment](./deployment).
