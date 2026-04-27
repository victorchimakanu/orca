# How I Built Orca

Type one English sentence. An autonomous agent trades correlated Polymarket markets while you sleep. Your key signs. The agent only proposes.

That is the pitch. This is the build log.

## What Orca Is

Polymarket has thousands of binary markets and a lot of them are logically linked. "Trump wins Pennsylvania" cannot be more probable than "Trump wins the election." "A Republican wins" is at least as likely as any individual Republican candidate. Candidate markets in a single winner race must sum to at most 1. When the orderbook violates one of those relationships by enough, the gap is free expected value.

The retail trader has three real options today.

1. Re price correlated markets by hand. Doable. Exhausting. Low edge.
2. Run a Python script you cannot fully audit. Custodial. Fragile. Breaks at 3am.
3. Hand the keys to a centralised hedge fund. Custodial. Opaque. Not yours.

Orca is option 4. One English sentence becomes a systematic prop trading strategy that runs continuously against the live orderbook, with a session scoped authorisation envelope. No keys handed over. No code written. No all night monitoring. No silent failure modes.

The compression here is the point. From "I have an opinion about correlated markets" to "the agent is trading my opinion" used to be a project. Now it is a sentence.

## What Most Polymarket Bots Look Like

I surveyed the open source Polymarket arb bots on GitHub. The pattern is consistent.

- Hardcoded condition IDs for the markets you care about
- Hardcoded poll loop on the CLOB endpoint
- Hardcoded EIP-712 domain in a constants file
- A signing module that imports `@polymarket/clob-client` directly and reads a private key from the environment
- One python file that does all of the above in 800 lines

It works. It is also fragile. The script breaks at 3am because Polymarket rotated a header. The script cannot tell you WHY it placed a trade, only that it did. The script holds your key.

The strategy is small. The plumbing is huge. Most of the code is exchange specific glue and key handling, neither of which generates alpha.

## What Orca Looks Like Instead

The strategy logic for an arb bot is maybe 200 lines. Pure functions. `extractConstraints()` pulls the logical relationships out of a cluster. `findViolations()` checks whether the live orderbook breaks any constraint by more than the policy's minimum EV. `sizeOrder()` clips to the per trade and per policy caps.

This logic is the same whether the venue is Polymarket, Kalshi, or whatever ships next. The strategy doesn't care about the venue. It cares about constraints, EV, and risk.

In Orca, the strategy stays in TypeScript. The execution layer is the aomi widget plus my wallet:

```ts
// Bot decides WHAT to trade
const proposal = findViolations(cluster, policy);
if (proposal) {
  // Bot describes the trade as an EIP-712 sign request
  await widget.emit("wallet_eip712_request", {
    typed_data: buildOrder(proposal, makerAddress),
  });
  // Widget queues it, my wallet signs it, signature comes back
  // Bot submits to the Polymarket CLOB
}
```

The bot never imports a signing library. The widget never sees the strategy. Three processes. Zero of them have access to anything they do not need.

## What I Shipped

Three processes. One SQLite database. One SSE stream. No message broker. No cloud. No shared keys.

- `apps/bot` (port 8787). Bun. Owns SQLite, the scan loop, the policy parser, the reasoning passes, the executor, the cap enforcement.
- `apps/web` (port 3000). Next.js 15. Hosts the aomi widget, the wallet adapter, and a four panel dashboard that streams from one SSE connection.
- `apps/mock-aomi` (port 8080). 200 line shim that speaks the aomi backend protocol on one side and the bot's HTTP on the other. Replace with a hosted aomi backend in production by flipping `NEXT_PUBLIC_BACKEND_URL`.

Adding a message broker, a cloud, or a multi user auth layer would buy nothing for one user. One user is the only deployment shape that preserves the non custodial property.

## The Aomi Pieces I Leaned On Hardest

The brief was clear. Use the aomi runtime, the widget, the auth adapter contract, the wallet event bus. Do not import the Rust SDK directly. Route through skills.

What carried the most weight.

- **`@aomi-labs/widget-lib`** for the chat surface, the wallet pill, the control bar, and the `RuntimeTxHandler`. Mounted broken apart so the wallet button could sit in the dashboard header. Configured to hide the model picker, the app picker, and the secrets UI. Orca only ever talks to one bot and only ever uses Gemini.
- **`@aomi-labs/react`** for `AomiRuntimeProvider`, which wires the wallet request queue, the thread list, and the SSE subscription. I hand it my wagmi backed auth adapter. It does the rest.
- **The aomi auth adapter contract.** The shape `{identity, isReady, canConnect, canManageAccount, connect, manageAccount, switchChain, sendTransaction, signTypedData}` is the load bearing piece of the whole project. It made the Para to wagmi swap a one file change. The contract is the asset.
- **The wallet event bus.** Emit `wallet_eip712_request` from the bot, the widget queues it, the adapter signs it, the response flows back over `POST /sign`. The bot never imports a signing library. The widget never sees a private key. Three processes, zero of them have access.

The agent proposes transactions. My code approves or denies. Same approve/reject pattern as a hardware wallet. For automated strategies.

## Architecture: Brain + Hands

```
┌─────────────────────────────────────────┐
│  ORCA BOT (the brain)                   │
│                                         │
│  policy.ts        parse English         │
│  scanner.ts       poll Polymarket CLOB  │
│  reasoning.ts     extract constraints   │
│  arb.ts           check violations      │
│  executor.ts      build EIP-712 orders  │
│                                         │
│  Emits wallet_eip712_request →          │
└─────────────────────────────────────────┘
            ↕ HTTP + SSE
┌─────────────────────────────────────────┐
│  AOMI WIDGET (the hands)                │
│                                         │
│  Queues sign requests                   │
│  My wallet signs locally                │
│  Returns signature                      │
│                                         │
│  ← Returns wallet_eip712_response       │
└─────────────────────────────────────────┘
```

The bot decides WHAT to trade. The widget decides HOW it gets signed. Strategy is deliberate and slow moving. Execution is opportunistic and fast adapting. The aomi widget makes that split clean.

## What I Had To Change While Building It

The plan was Para session signer, full stop. Para's MPC enclave co signs inside a bounded envelope, the master key never moves, the user revokes with one click. That is the architecture you want for "agent runs while I sleep."

In practice, Para's BETA environment refused my email auth code three times in a row. I swapped the adapter to wagmi plus the `injected()` connector. MetaMask popups every leg. Hands on signing.

The aomi auth adapter contract made this swap a one file change. The repo still has the Para code path behind `NEXT_PUBLIC_PARA_API_KEY`. Both flows work.

The lesson: the signer is supposed to be swappable. The contract is the asset. If you are building on aomi, write your auth adapter once, swap the underlying signer freely.

The other big change. aomi-labs has not published the backend/runtime yet, so I wrote a 200 line shim at [apps/mock-aomi/server.ts](apps/mock-aomi/server.ts) that serves the aomi HTTP plus SSE protocol locally and forwards the parts I care about (chat to policy parse, sign requests, sign responses) to my bot. This was the single most useful thing I did. It also revealed two places where the aomi runtime expectations did not match what I had built first.

1. `/api/sessions` is overloaded. Without query params it is "create or fetch session id" returning `{id}`. With `?public_key=…` it is "list threads" returning `[]`. The runtime's `for (const t of threadList)` crashes if you confuse the two. The shim now branches on the query param.
2. The runtime does not poll until something says it should. The session only starts polling `/api/state` when `is_processing: true` arrives in a state response. If the user connects their wallet AFTER the bot has begun emitting sign requests, the widget never sees them. The runtime only fetches state once at thread mount. The shim fixes this by setting `is_processing: true` whenever a wallet is registered, which keeps the runtime polling continuously.

Both small. Both took a while to find.

The third change. The bot uses the connected wallet address as the EIP-712 `maker` field of the order. Without that, the widget's `signTypedData` call signs against a maker address that is not the actual signer. Polymarket rejects it. Solution, [`apps/web/components/wallet-sync.tsx`](apps/web/components/wallet-sync.tsx). One `useEffect`, fires on wagmi `address` changes, POSTs `{address}` to the bot's `/wallet` endpoint. The bot uses that address as the maker the next time it builds an order. One file. Also the reason every leg in the dashboard's fills section has the right maker.

## Areas Of The Aomi Docs I Had To Reverse Engineer

In rough order of how much time I spent.

- **The auth adapter contract.** The shape is the load bearing piece. It took reading the runtime source to find it.
- **The wallet event bus payload shape.** `WalletEip712Payload.typed_data` wraps `{domain, types, primaryType, message}`. The widget passes the full wrapper to the adapter, the adapter has to unwrap before forwarding to wagmi. Easy to miss.
- **The polling lifecycle.** Polling kicks off only when `is_processing: true` is observed in a state response. There is no "kick polling because user just connected" event. Once you know, you build around it.
- **The mock backend protocol.** No public reference for `/api/sessions`, `/api/state`, `/api/chat`, `/api/system`, `/api/updates`, `/api/events`. I derived it from the client source. The shim in `apps/mock-aomi` is the cleanest reference I have for someone else trying the same thing.

If you are about to do the same project, those four bullets will save you most of a day.

## Tradeoffs I Made

**Replay mode is the default.** The first instinct when showing this off is "show real numbers, real markets, real fills." The reality is that a live demo is a coin flip. Polymarket's orderbook is mostly efficient. Most scan cycles produce zero proposals. When a proposal does land, you are racing every other Polymarket bot in the world to fill it, and you usually lose. You cannot ship a 90 second demo against a market that does not cooperate. So the default is `DEMO_MODE=replay`. The fixture is a real Polymarket cluster format with a planted 100 bps subset violation. The pipeline is identical, only the source of `MarketSnapshot[]` is different. Reproducible, deterministic, no rate limits, cleaner debugging. The trade off is right for a demo. It would be wrong for a production product.

**MetaMask popups, not Para sessions.** As above. The Para path is more compelling for "agent runs while I sleep." The wagmi path is what shipped on the clock. Both work. The contract makes them interchangeable.

**Mock aomi backend, not the real one.** The shim is fine for one user on a laptop. The real backend gets you thread persistence, model picker fan out, and presumably some auth.

**The bot builds Polymarket orders in TypeScript.** Right now `packages/aomi-bridge` builds the CTF Exchange Order struct directly, ~150 lines of deterministic struct math. Delegating to the `aomi-transact` skill would give us approval choreography for free. Concretely blocked, not lazy. The plugin exists at [`aomi-sdk/apps/polymarket`](https://github.com/aomi-labs/aomi-sdk/tree/main/apps/polymarket) but it is Rust source. It compiles to a `.dylib` that needs an aomi runtime to load it, and the runtime is the piece aomi-labs explicitly has not published yet. `gemini-cli` skills are markdown prompt extensions, not plugin loaders. So the swap is one env flag away the day the runtime ships.

## What's Next

- **Run a real aomi backend.** Thread persistence, model picker, auth.
- **Switch the default signer to Para.** Once Para's BETA env is reliable, the hands off session signer story is more compelling than MetaMask popups.
- **A proper "go live" wizard in the dashboard.** Today, going live is three env vars. It should be a button.
- **The aomi-transact skill instead of the in repo order builder, when aomi ships the runtime.** Approval choreography for free. Multi venue support when the skill grows it.
- **A second venue.** Kalshi has a solid REST API. The same reasoning engine works. The market opens up dramatically the moment you can hedge across venues.

## The Repo

```bash
git clone https://github.com/aomi-labs/orca
cd orca
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm replay` runs the full pipeline against the fixture that fires a guaranteed 100 bps arb. Offline. Reproducible. Judge proof.

The Docusaurus site under `apps/docs` is the deeper reference. Quickstart, user flow with screenshots, going live, how aomi fits, extending, architecture, tradeoffs, policy language, API reference, deployment.

Write the policy you would actually want to run. Let the agent handle the execution you have always hated.

If you ship something on top of aomi, tag @aomi_labs.
