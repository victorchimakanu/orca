"use client";

import type { BotEvent } from "@autopilot/shared-types";

const TONE: Record<string, string> = {
  cluster: "text-muted",
  constraint: "text-accent",
  proposal: "text-white",
  rejection: "text-muted",
  fill: "text-accent",
  policy_parsed: "text-accent",
  halt: "text-danger",
  wallet_tx_request: "text-white",
  wallet_eip712_request: "text-white",
  pnl: "text-muted",
};

function label(event: BotEvent): { tag: string; body: string; at: number } {
  switch (event.type) {
    case "reasoning":
      return { tag: event.trace.kind, body: event.trace.summary, at: event.trace.at };
    case "proposal":
      return {
        tag: "proposal",
        body: `ARB ${(event.proposal.evBps / 100).toFixed(2)}% · $${event.proposal.sizeUsd.toFixed(2)} · ${event.proposal.clusterLabel}`,
        at: event.proposal.createdAt,
      };
    case "policy_parsed":
      return { tag: "policy", body: event.policy.rawText, at: event.policy.createdAt };
    case "halt":
      return { tag: "halt", body: event.reason, at: Date.now() };
    case "fill":
      return {
        tag: "fill",
        body: `${event.fill.action} ${event.fill.side} ${event.fill.conditionId.slice(0, 10)}… @ ${event.fill.price} · $${event.fill.sizeUsd.toFixed(2)}`,
        at: event.fill.at,
      };
    case "pnl":
      return {
        tag: "pnl",
        body: `realized $${event.snapshot.realizedUsd.toFixed(2)} · unrealized $${event.snapshot.unrealizedUsd.toFixed(2)} · deployed $${event.snapshot.deployedUsd.toFixed(2)}`,
        at: event.snapshot.at,
      };
    default:
      return { tag: event.type, body: JSON.stringify(event).slice(0, 200), at: Date.now() };
  }
}

export function ReasoningLog({ events }: { events: BotEvent[] }) {
  const rows = events.slice(-200).reverse().map(label);
  return (
    <div className="flex h-full flex-col border-l border-line bg-panel">
      <div className="border-b border-line px-4 py-3">
        <div className="text-xs uppercase tracking-widest text-muted">reasoning log</div>
        <div className="mt-1 font-mono text-sm text-accent">live · {events.length} events</div>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-3 py-2 font-mono text-[11px] scrollbar-thin">
        {rows.length === 0 && (
          <div className="px-2 py-10 text-center text-muted">waiting for orchestrator...</div>
        )}
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 border-b border-line/40 py-1">
            <span className="w-20 shrink-0 text-muted">{new Date(r.at).toLocaleTimeString()}</span>
            <span className={`w-24 shrink-0 ${TONE[r.tag] ?? "text-muted"}`}>{r.tag}</span>
            <span className="flex-1 whitespace-pre-wrap break-words">{r.body}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
