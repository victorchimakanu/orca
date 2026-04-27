import type { BotEvent, MarketSnapshot, Policy, ReasoningTrace, SignedPayload } from "@autopilot/shared-types";
import { SignedPayloadSchema } from "@autopilot/shared-types";
// Bun automatically loads .env from the nearest .env and project root.
// https://bun.sh/docs/runtime/env — no dotenv package needed.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { bus } from "./events/bus";
import { executeProposal } from "./execution/submit";
import { cancelAll, resolveSignature } from "./execution/pending";
import { clearWallet, getWalletInfo, setWalletAddress } from "./execution/wallet";
import { clearClobCreds, getClobCreds, setClobCreds } from "./execution/clob-auth";
import { parsePolicy } from "./policy/parser";
import { defaultPolicy } from "./policy/schema";
import { extractConstraints } from "./reasoning/constraints";
import { evaluateConstraint } from "./reasoning/arb";
import { groupByCorrelation, marketMap } from "./reasoning/grouper";
import { scan } from "./scanner/polymarket";
import { deployedUsd, listFills, listSnapshots, savePolicy, saveSnapshot } from "./tracker/db";
import { currentPositions, pnlSnapshot } from "./tracker/positions";

const HOST = process.env.BOT_HOST ?? "127.0.0.1";
const PORT = Number(process.env.BOT_PORT ?? 8787);
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS ?? 120_000);
const EXECUTE_ENABLED = process.env.EXECUTE_ENABLED !== "false";

let currentPolicy: Policy = defaultPolicy();
let scanTimer: ReturnType<typeof setInterval> | null = null;
let halted = false;
const latestMarkets = new Map<string, MarketSnapshot>();

function trace(kind: ReasoningTrace["kind"], summary: string, clusterLabel: string | null = null, detail?: unknown): void {
  const t: ReasoningTrace = {
    id: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    kind,
    clusterLabel,
    summary,
    detail,
  };
  bus.publish({ type: "reasoning", trace: t });
  console.log(`[${kind}] ${summary}`);
}

function publishPnl(): void {
  const positions = currentPositions(latestMarkets);
  const snapshot = pnlSnapshot(positions, deployedUsd());
  saveSnapshot(snapshot);
  for (const p of positions) bus.publish({ type: "position", position: p });
  bus.publish({ type: "pnl", snapshot });
}

async function runScanCycle(): Promise<void> {
  if (halted) return;
  try {
    const scans = await scan(currentPolicy);
    const clusters = await groupByCorrelation(scans);

    // Refresh market-price cache for mark-to-market.
    for (const s of scans) {
      for (const m of s.markets) latestMarkets.set(m.conditionId, m);
    }

    trace("cluster", `scanned ${scans.length} cluster(s), ${scans.reduce((n, s) => n + s.markets.length, 0)} markets total`);

    for (const cluster of clusters) {
      const constraints = await extractConstraints(cluster);
      if (constraints.length === 0) {
        trace("rejection", `no logical constraints extracted`, cluster.cluster);
        continue;
      }

      const markets = marketMap(cluster.markets);
      for (const constraint of constraints) {
        trace("constraint", constraint.explanation, cluster.cluster, constraint);
        const proposal = evaluateConstraint(constraint, markets, currentPolicy);
        if (!proposal) {
          trace("rejection", `constraint holds within tolerance (no arb, EV below ${(currentPolicy.minEV * 100).toFixed(2)}%)`, cluster.cluster);
          continue;
        }
        bus.publish({ type: "proposal", proposal });
        trace(
          "proposal",
          `ARB ${(proposal.evBps / 100).toFixed(2)}% EV · $${proposal.sizeUsd.toFixed(2)} size · ${proposal.legs.length} legs`,
          cluster.cluster,
          proposal,
        );

        if (!EXECUTE_ENABLED) continue;

        // Build title map for fill bookkeeping + kick off execution.
        const titles = new Map<string, string>();
        for (const m of cluster.markets) titles.set(m.conditionId, m.title);
        executeProposal(proposal, currentPolicy, titles, latestMarkets)
          .then((result) => {
            if (result.kind === "ok") {
              trace("execution", `executed ${result.fills.length} legs · deployed=$${deployedUsd().toFixed(2)}`, cluster.cluster);
              publishPnl();
            } else if (result.kind === "cap_exceeded") {
              trace(
                "rejection",
                `cap exceeded · deployed $${result.deployed.toFixed(2)} + needed $${result.sizeUsd.toFixed(2)} > $${result.cap}`,
                cluster.cluster,
              );
            } else if (result.kind === "signature_timeout") {
              trace("rejection", `signature timeout on leg ${result.legIndex}`, cluster.cluster);
            } else if (result.kind === "submit_failed") {
              trace("rejection", `CLOB submit failed on leg ${result.legIndex}: ${result.error}`, cluster.cluster);
            }
          })
          .catch((err) => {
            trace("rejection", `execution threw: ${err instanceof Error ? err.message : String(err)}`, cluster.cluster);
          });
      }
    }

    publishPnl();
  } catch (err) {
    console.error("[scan] cycle failed", err);
  }
}

function startLoop(): void {
  if (scanTimer) return;
  runScanCycle();
  scanTimer = setInterval(runScanCycle, SCAN_INTERVAL_MS);
}

function stopLoop(): void {
  if (!scanTimer) return;
  clearInterval(scanTimer);
  scanTimer = null;
}

// ── HTTP ────────────────────────────────────────────────────────────────
const app = new Hono();
app.use("*", cors());

app.get("/health", (c) =>
  c.json({
    ok: true,
    demoMode: process.env.DEMO_MODE ?? "replay",
    executionMode: process.env.EXECUTION_MODE ?? "dry",
    halted,
    deployedUsd: deployedUsd(),
  }),
);

app.get("/policy", (c) => c.json({ policy: currentPolicy, halted }));

app.post("/policy", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rawText = typeof body.rawText === "string" ? body.rawText.trim() : "";
  if (!rawText) {
    return c.json({ ok: false, error: "rawText is required" }, 400);
  }
  try {
    currentPolicy = process.env.GEMINI_API_KEY
      ? await parsePolicy(rawText)
      : defaultPolicy(rawText);
    savePolicy(currentPolicy);
    halted = false;
    bus.publish({ type: "policy_parsed", policy: currentPolicy });
    trace(
      "cluster",
      `policy parsed · topics=[${currentPolicy.topics.join(", ")}] · minEV=${(currentPolicy.minEV * 100).toFixed(2)}% · maxPerTrade=$${currentPolicy.maxPerTrade} · cap=$${currentPolicy.maxTotal}`,
    );
    startLoop();
    return c.json({ ok: true, policy: currentPolicy });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[policy] parse failed:", msg);
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.post("/kill", (c) => {
  halted = true;
  stopLoop();
  cancelAll("kill switch");
  bus.publish({ type: "halt", reason: "user kill switch" });
  return c.json({ ok: true, halted: true });
});

app.post("/sign", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = SignedPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: parsed.error.message }, 400);
  }
  const payload: SignedPayload = parsed.data;
  const ok = resolveSignature(payload);
  if (!ok) {
    return c.json({ ok: false, error: "no pending signature for that id (expired or unknown)" }, 404);
  }
  return c.json({ ok: true });
});

app.get("/wallet", (c) => c.json(getWalletInfo()));

app.post("/wallet", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const addr = typeof body?.address === "string" ? body.address : "";
  const result = setWalletAddress(addr);
  if (!result.ok) return c.json({ ok: false, error: result.error }, 400);
  return c.json({ ok: true, ...getWalletInfo() });
});

app.delete("/wallet", (c) => {
  clearWallet();
  clearClobCreds();
  return c.json({ ok: true });
});

app.get("/clob-auth", (c) => c.json({ hasCreds: Boolean(getClobCreds()) }));

app.post("/clob-auth", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { apiKey, secret, passphrase, address } = body ?? {};
  if (typeof apiKey !== "string" || typeof secret !== "string" || typeof passphrase !== "string" || typeof address !== "string") {
    return c.json({ ok: false, error: "apiKey, secret, passphrase, address required" }, 400);
  }
  setClobCreds({ apiKey, secret, passphrase, address: address.toLowerCase() });
  return c.json({ ok: true });
});

app.get("/fills", (c) => c.json({ fills: listFills(100) }));

app.get("/positions", (c) => c.json({ positions: currentPositions(latestMarkets) }));

app.get("/pnl", (c) => c.json({ snapshots: listSnapshots(200) }));

app.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const unsubscribe = bus.subscribe((event: BotEvent) => {
      stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
    });

    await stream.writeSSE({
      event: "policy_parsed",
      data: JSON.stringify({ type: "policy_parsed", policy: currentPolicy }),
    });

    stream.onAbort(() => unsubscribe());
    while (!stream.aborted) {
      await stream.sleep(15_000);
      await stream.writeSSE({ event: "ping", data: String(Date.now()) });
    }
  }),
);

console.log(
  `[bot] starting on http://${HOST}:${PORT} · demoMode=${process.env.DEMO_MODE ?? "replay"} · executionMode=${process.env.EXECUTION_MODE ?? "dry"} · execute=${EXECUTE_ENABLED}`,
);
startLoop();

export default {
  fetch: app.fetch,
  hostname: HOST,
  port: PORT,
};
