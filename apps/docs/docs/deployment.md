---
sidebar_position: 12
title: Deployment
---

# Deployment

**Orca is designed to be run locally, by one user, for their own account.** That is not a limitation, it is the security model. The non custodial story only works when you are the one holding the session key.

## Recommended, run it on your own machine

```bash
pnpm install
pnpm dev
```

- **Bot** (`apps/bot`) uses `bun:sqlite`. The DB file lives at `./data/bot.db`. Persists across restarts.
- **Web** (`apps/web`) is a Next.js dev server. In production build with `pnpm --filter web build && pnpm --filter web start`.
- **Mock aomi** (`apps/mock-aomi`) is the protocol shim between the widget and the bot. Always on during development. Replace with a hosted aomi backend in production by pointing `NEXT_PUBLIC_BACKEND_URL`.
- **Docs** (`apps/docs`) is optional. Serve with `pnpm --filter docs start` or host a static build on any CDN.

## Running 24/7 on a Mac mini or home server

The bot does not need a GPU or much memory. A Mac mini, a Raspberry Pi 5, or any always on machine works fine.

```bash
pnpm --filter bot start
```

Keep the web app up only when you want to interact. The bot runs headlessly. The dashboard is a viewer, not a controller.

The "agent runs while I sleep" property only really lands once you have flipped to the Para session signer. With MetaMask popups every leg, "headless" means "popups pile up in a tab no one is watching" which is not the product.

## Running web on Vercel

Works if you also expose the bot to the public internet, which defeats the security model. Do not.

If you must split processes.

- Put the bot on a machine you control. Tailscale to your home network is perfect.
- Set `NEXT_PUBLIC_BOT_URL` on Vercel to the bot's Tailscale hostname.
- Do not expose the bot to the public internet. There is no authentication on `/policy` or `/kill`.

## Anti recommendation, multi user hosting

**Do not host this for others.** The architecture makes strong assumptions.

- **One Para session per process.** The bot has no tenant isolation. Two users would share a pending signatures map.
- **One SQLite database.** Positions, fills, and PnL are globally keyed. A second user would see the first user's positions.
- **No auth.** `/policy` and `/kill` are open. In a shared deployment, any user can halt any other user.

If you need multi user, fork and rebuild with proper tenant isolation. Per tenant SQLite, per tenant event bus, per tenant Para session, auth on every endpoint, rate limits. That is a different product.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GEMINI_API_KEY` | yes (M2+) | none | Gemini 2.5 Flash and Pro |
| `POLYGON_RPC` | `EXECUTION_MODE=live` only | `https://polygon-rpc.com` | Chain reads |
| `BOT_HOST` | no | `127.0.0.1` | Bind address |
| `BOT_PORT` | no | `8787` | Bot HTTP port |
| `SCAN_INTERVAL_MS` | no | `30000` | Scan cadence |
| `BOT_DB_PATH` | no | `./data/bot.db` | SQLite path |
| `DEMO_MODE` | no | `replay` | `replay` or `live` |
| `EXECUTION_MODE` | no | `dry` | `dry` or `live` |
| `EXECUTE_ENABLED` | no | `true` | Disable the post proposal execute path |
| `NEXT_PUBLIC_BOT_URL` | no | `http://127.0.0.1:8787` | Where the web app looks for the bot |
| `NEXT_PUBLIC_BACKEND_URL` | no | `http://127.0.0.1:8080` | aomi backend URL (mock or hosted) |
| `NEXT_PUBLIC_SIGNER_MODE` | no | `mock` | `mock`, `click`, or `live` |
| `NEXT_PUBLIC_PARA_API_KEY` | `SIGNER_MODE=live` only | none | Para public API key (dashboard.getpara.com) |
| `NEXT_PUBLIC_PARA_ENV` | no | `BETA` | `BETA` or `PROD`, match to key environment |
| `NEXT_PUBLIC_APP_NAME` | no | `Orca` | Shown in the wallet login modal |
| `NEXT_PUBLIC_POLYGON_RPC` | no | `https://polygon-rpc.com` | RPC for the viem client in live mode |
| `SIGNATURE_TIMEOUT_MS` | no | `60000` | How long to wait for a sign response |

## Flipping to live signing

The default config (`DEMO_MODE=replay`, `EXECUTION_MODE=dry`, `NEXT_PUBLIC_SIGNER_MODE=mock`) never touches the chain. Three switches stand between the demo and a real $1 USDC order.

1. **Wallet account.** Either connect MetaMask via the widget's wallet button, or set `NEXT_PUBLIC_PARA_API_KEY` to swap to Para's session signer. Set `NEXT_PUBLIC_SIGNER_MODE=live` either way.
2. **Real market data.** Set `DEMO_MODE=live` so the scanner hits Gamma and CLOB instead of the fixture. Still no money at risk. Orders are built but only simulated.
3. **Real execution.** Set `EXECUTION_MODE=live`. Fund the connected address with ~$2 USDC on Polygon (one for the first approval gas, one to trade). Keep `maxTotal` tight (for example `$1`). Watch one small order fill end to end before turning the caps up.

Each step is independently reversible by flipping the env var back. See [Going Live](./going-live) for the walk through.

## Operational tips

- **Scan cadence.** 30s is comfortable. Going below 10s risks hitting Polymarket rate limits. Going above 60s leaves slower arbs on the table. Stick to 30s unless you have a reason.
- **Rate limits.** Gamma and CLOB are both generous for our load (40 markets per cycle), but if you run multiple instances against the same key you will get 429s. The grouper and constraint extractor both retry on 429/503 with exp backoff.
- **Gemini free tier.** Flash is 15 RPM and Pro is 2 RPM on the free tier. One instance fits comfortably. Two instances on one key can throttle Pro.
- **Disk.** SQLite plus Polymarket snapshots grow slowly. 50 MB/month is a reasonable upper bound. Rotate or vacuum quarterly if you care.
- **Backups.** Back up `./data/bot.db`. That is the only local only state that matters.
