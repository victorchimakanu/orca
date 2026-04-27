/**
 * aomi-bridge — speaks the aomi client protocol on one side, the bot on the other.
 *
 *  widget ─── aomi protocol ───► bridge :8080 ─── bot protocol ───► bot :8787
 *    │                                                                  │
 *    ├─ POST /api/chat?message=…       → POST /policy  (Gemini parse)   │
 *    ├─ GET  /api/state?user_state=…   ← drain pending wallet reqs ←────┤ (bot SSE /events)
 *    └─ POST /api/system?message=…     → POST /sign   (signature relay) │
 *
 * The bridge is stateful per session: each session owns a messages log plus
 * two maps — `pending_eip712s` and `pending_txs` — that the widget's
 * `Session.syncWalletRequests()` reads from the returned `user_state`.
 */

const PORT = Number(process.env.MOCK_AOMI_PORT ?? 8080);
const BOT_URL = process.env.BOT_URL ?? "http://127.0.0.1:8787";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Session-Id, X-API-Key",
};

type AomiMessage = {
  sender: "user" | "agent" | "system";
  content: string;
  timestamp: string;
  is_streaming?: boolean;
  tool_result?: [string, string] | null;
};

type Eip712Payload = {
  typed_data: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  };
  description?: string;
};

type TxPayload = {
  to: string;
  value?: string;
  data?: string;
  chainId?: number;
};

type SessionState = {
  messages: AomiMessage[];
  pendingEip712s: Map<number, { botId: string; payload: Eip712Payload }>;
  pendingTxs: Map<number, { botId: string; payload: TxPayload }>;
  lastUserAddress?: string;
  nextId: number;
};

const sessions = new Map<string, SessionState>();

const getSession = (id: string): SessionState => {
  const existing = sessions.get(id);
  if (existing) return existing;
  const fresh: SessionState = {
    messages: [],
    pendingEip712s: new Map(),
    pendingTxs: new Map(),
    nextId: 1,
  };
  sessions.set(id, fresh);
  return fresh;
};

// Global session used when the bot emits a wallet request — in this single-user
// demo every widget tab shares the same orchestrator, so we broadcast to every
// active session. The widget polls /api/state and drains pending requests.
const allSessions = () => sessions.values();

function stateFor(sessionId: string) {
  const s = getSession(sessionId);
  const pending_eip712s: Record<string, unknown> = {};
  for (const [id, { payload }] of s.pendingEip712s.entries()) {
    pending_eip712s[String(id)] = payload;
  }
  const pending_txs: Record<string, unknown> = {};
  for (const [id, { payload }] of s.pendingTxs.entries()) {
    pending_txs[String(id)] = payload;
  }
  const hasPending = s.pendingEip712s.size > 0 || s.pendingTxs.size > 0;
  const walletConnected = Boolean(s.lastUserAddress);
  return {
    messages: s.messages,
    system_events: [],
    title: null,
    is_processing: hasPending || walletConnected,
    user_state: {
      pending_eip712s,
      pending_txs,
      is_connected: Boolean(s.lastUserAddress),
      address: s.lastUserAddress,
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

function parseUserStateParam(url: URL): Record<string, unknown> | null {
  const raw = url.searchParams.get("user_state");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function captureAddress(sessionId: string, url: URL): void {
  const us = parseUserStateParam(url);
  if (!us) return;
  const addr = typeof us.address === "string" ? us.address : undefined;
  if (addr) getSession(sessionId).lastUserAddress = addr;
}

function formatPolicy(policy: any): string {
  const lines = [
    `Policy parsed by Gemini 2.5 Pro:`,
    ``,
    `topics: [${(policy.topics ?? []).join(", ") || "—"}]`,
    `minEV: ${((policy.minEV ?? 0) * 100).toFixed(2)}%`,
    `minLiquidityPerSide: $${policy.minLiquidityPerSide ?? 0}`,
    `maxPerTrade: $${policy.maxPerTrade ?? 0}`,
    `maxTotal (cap): $${policy.maxTotal ?? 0}`,
  ];
  if (policy.expiresAt) lines.push(`expiresAt: ${new Date(policy.expiresAt).toISOString()}`);
  lines.push(``, `The orchestrator is now scanning live markets every 30s. Proposals and fills will stream to the dashboard on the right.`);
  return lines.join("\n");
}

async function forwardToBot(message: string): Promise<AomiMessage> {
  try {
    const res = await fetch(`${BOT_URL}/policy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText: message }),
    });
    const body = (await res.json()) as { ok?: boolean; policy?: any; error?: string };
    if (!res.ok || !body.ok) {
      return {
        sender: "agent",
        content: `Couldn't parse that policy — ${body.error ?? `HTTP ${res.status}`}. Try: "Watch Trump markets, arbs > 0.5% EV, max $50 per trade, cap $500."`,
        timestamp: new Date().toISOString(),
      };
    }
    return {
      sender: "agent",
      content: formatPolicy(body.policy),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      sender: "agent",
      content: `Bot unreachable at ${BOT_URL} (${msg}). Make sure apps/bot is running on :8787.`,
      timestamp: new Date().toISOString(),
    };
  }
}

// ── Bot → bridge: broadcast wallet requests into every active session ────────

function broadcastEip712(botId: string, payload: Eip712Payload): void {
  for (const s of allSessions()) {
    const id = s.nextId++;
    s.pendingEip712s.set(id, { botId, payload });
  }
  // If no session has polled yet, keep it for the default session.
  if (sessions.size === 0) {
    const s = getSession("default");
    const id = s.nextId++;
    s.pendingEip712s.set(id, { botId, payload });
  }
}

function broadcastTx(botId: string, payload: TxPayload): void {
  for (const s of allSessions()) {
    const id = s.nextId++;
    s.pendingTxs.set(id, { botId, payload });
  }
  if (sessions.size === 0) {
    const s = getSession("default");
    const id = s.nextId++;
    s.pendingTxs.set(id, { botId, payload });
  }
}

// ── Bridge → bot: signature relay ───────────────────────────────────────────

async function forwardSignature(args: {
  botId: string;
  kind: "eip712" | "tx";
  signature?: string;
  txHash?: string;
  signerAddress: string;
}): Promise<boolean> {
  try {
    const body =
      args.kind === "eip712"
        ? {
            id: args.botId,
            kind: "eip712",
            signature: args.signature ?? "",
            signerAddress: args.signerAddress,
          }
        : {
            id: args.botId,
            kind: "tx",
            signature: args.signature ?? "",
            signerAddress: args.signerAddress,
            txHash: args.txHash,
          };
    const res = await fetch(`${BOT_URL}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[bridge] /sign failed: HTTP ${res.status} ${text}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[bridge] /sign error:", err);
    return false;
  }
}

// ── SSE subscription to bot ─────────────────────────────────────────────────

import http from "node:http";

function subscribeOnce(onConnected: () => void): Promise<void> {
  return new Promise((resolve) => {
    const url = new URL(`${BOT_URL}/events`);
    const req = http.get(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        headers: { Accept: "text/event-stream" },
      },
      (res) => {
        if (res.statusCode !== 200) {
          console.error(`[bridge] SSE HTTP ${res.statusCode}`);
          res.resume();
          resolve();
          return;
        }
        onConnected();
        res.setEncoding("utf8");
        let buffer = "";
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            handleSseFrame(raw);
          }
        });
        res.on("end", () => resolve());
        res.on("error", (err) => {
          console.error("[bridge] SSE stream error:", err.message);
          resolve();
        });
      },
    );
    req.on("error", (err) => {
      console.error("[bridge] SSE request error:", err.message);
      resolve();
    });
  });
}

async function subscribeToBot(): Promise<void> {
  let backoff = 1000;
  for (;;) {
    console.log(`[bridge] subscribing to ${BOT_URL}/events`);
    await subscribeOnce(() => {
      backoff = 1000;
    });
    console.log(`[bridge] SSE disconnected — reconnecting in ${backoff}ms`);
    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, 15_000);
  }
}

function handleSseFrame(raw: string): void {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return;
  let data: any;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }

  if (eventName === "wallet_eip712_request" && typeof data.id === "string") {
    broadcastEip712(data.id, {
      typed_data: {
        domain: data.domain,
        types: data.types,
        primaryType: data.primaryType,
        message: data.message,
      },
      description: `Polymarket order · proposal ${data.proposalId ?? ""} leg ${data.legIndex ?? ""}`,
    });
    console.log(`[bridge] queued EIP-712 sign request ${data.id} for widget`);
  } else if (eventName === "wallet_tx_request" && typeof data.id === "string") {
    broadcastTx(data.id, {
      to: data.to,
      value: data.value,
      data: data.data,
      chainId: data.chainId,
    });
    console.log(`[bridge] queued tx request ${data.id} for widget`);
  }
}

// ── System message handler ──────────────────────────────────────────────────

async function handleSystemMessage(sessionId: string, rawMessage: string): Promise<void> {
  const s = getSession(sessionId);
  let parsed: { type?: string; payload?: any };
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return;
  }

  const t = parsed.type;
  const p = parsed.payload ?? {};

  if (t === "wallet_eip712_response") {
    const pendingId = Number(p.pending_eip712_id);
    if (!Number.isFinite(pendingId)) return;
    const entry = s.pendingEip712s.get(pendingId);
    if (!entry) return;
    s.pendingEip712s.delete(pendingId);
    if (p.status === "success" && typeof p.signature === "string") {
      const signerAddress = s.lastUserAddress ?? "";
      await forwardSignature({
        botId: entry.botId,
        kind: "eip712",
        signature: p.signature,
        signerAddress,
      });
      console.log(`[bridge] relayed signature for bot id ${entry.botId}`);
    } else {
      console.log(`[bridge] widget rejected EIP-712 ${entry.botId}: ${p.error ?? "unknown"}`);
    }
  } else if (t === "wallet:tx_complete") {
    const pendingId = Number(p.pending_tx_id);
    if (!Number.isFinite(pendingId)) return;
    const entry = s.pendingTxs.get(pendingId);
    if (!entry) return;
    s.pendingTxs.delete(pendingId);
    if (p.status === "success" && typeof p.txHash === "string") {
      const signerAddress = s.lastUserAddress ?? "";
      await forwardSignature({
        botId: entry.botId,
        kind: "tx",
        txHash: p.txHash,
        signerAddress,
      });
      console.log(`[bridge] relayed tx hash for bot id ${entry.botId}`);
    } else {
      console.log(`[bridge] widget rejected tx ${entry.botId}: ${p.error ?? "unknown"}`);
    }
  }
}

// ── HTTP server ─────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;
    const sessionId = req.headers.get("X-Session-Id") ?? "default";

    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    // Static control endpoints
    if (pathname === "/api/control/apps") return json(["default"]);
    if (pathname === "/api/control/models") return json(["gemini-2.5-pro", "gemini-2.5-flash"]);
    if (pathname === "/api/control/provider-keys") return json([]);
    if (pathname === "/api/sessions") {
      if (url.searchParams.has("public_key")) return json([]);
      return json({ id: sessionId });
    }
    if (pathname === "/api/secrets") return json({ handles: {} });

    if (pathname === "/api/state") {
      captureAddress(sessionId, url);
      return json(stateFor(sessionId));
    }

    if (pathname === "/api/chat" && req.method === "POST") {
      captureAddress(sessionId, url);
      const message = url.searchParams.get("message") ?? "";
      if (!message.trim()) return json(stateFor(sessionId));

      const s = getSession(sessionId);
      s.messages.push({
        sender: "user",
        content: message,
        timestamp: new Date().toISOString(),
      });

      const reply = await forwardToBot(message);
      s.messages.push(reply);

      return json(stateFor(sessionId));
    }

    if (pathname === "/api/system" && req.method === "POST") {
      const message = url.searchParams.get("message") ?? "";
      if (message.trim()) await handleSystemMessage(sessionId, message);
      return json({ res: null });
    }

    if (pathname === "/api/interrupt" && req.method === "POST") {
      return json(stateFor(sessionId));
    }

    if (pathname === "/api/events") return json([]);

    if (pathname === "/api/updates") {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(": connected\n\n"));
          const interval = setInterval(() => {
            controller.enqueue(encoder.encode(": ping\n\n"));
          }, 15_000);
          req.signal.addEventListener("abort", () => {
            clearInterval(interval);
            controller.close();
          });
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...CORS,
        },
      });
    }

    return json({ error: "not_found", path: pathname }, 404);
  },
});

console.log(
  `[bridge] listening on :${PORT} · chat→${BOT_URL}/policy · sigs→${BOT_URL}/sign · events←${BOT_URL}/events`,
);
subscribeToBot();
