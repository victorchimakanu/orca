# How I Built Orca

Type one English sentence. An autonomous agent trades correlated Polymarket markets while you sleep. Your wallet signs. The agent only proposes.

## Who Orca is for

The retail Polymarket trader who has an opinion but not the time. Someone who can see that "Trump wins Pennsylvania" should never price higher than "Trump wins the election" — that one of those numbers has to be wrong — but doesn't want to write a Python script, run a server at 3am, or hand their keys to a hedge fund to act on it.

Today that trader has three options. Re-price by hand (exhausting, low edge). Run a script you can't fully audit (custodial, fragile, breaks at 3am). Hand the keys to a centralised fund (custodial, opaque, not yours). Orca is option 4.

## Why this changes their life

The compression is the point. From *"I have an opinion about correlated markets"* to *"the agent is trading my opinion"* used to be a project. Now it is a sentence.

- **Non-custodial.** The bot never sees a private key. Every order is an EIP-712 sign request that the user's wallet approves locally. Same approve-or-reject pattern as a hardware wallet, but automated.
- **Auditable.** Every proposal lands in a live reasoning log — accepted, rejected, and the rule that motivated it. The user watches the agent think.
- **Hands off.** The bot scans the orderbook every 30 seconds, all night long. The user goes to sleep.
- **Plain English.** No DSL, no YAML, no code. One sentence describes the strategy and the caps. Gemini turns it into a typed policy.
- **Reproducible.** Replay mode runs the full pipeline against a fixture, offline, no USDC at risk — the same code path that ships to production.

## What I'd build next

- **Para session signer as the default.** Replace MetaMask popups with a bounded co-signing envelope so the agent really can run while the user sleeps.
- **A second venue.** Kalshi has a clean REST API and the same reasoning engine works. Hedging across venues opens the market dramatically.
- **A hosted aomi backend.** Replace the local 200 line shim with thread persistence, model picker, and auth.
- **A "go live" wizard in the dashboard.** Today, switching from replay to live is three env vars. It should be a button.
- **The aomi-transact skill instead of the in-repo order builder.** Approval choreography for free, multi-venue support when the skill grows it.

The full build log, architecture, and tradeoffs live in the Docusaurus site under `apps/docs`. This page is the one pager.
