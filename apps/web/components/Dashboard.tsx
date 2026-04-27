"use client";

import type { ArbProposal, BotEvent, Fill } from "@autopilot/shared-types";
import { PnlPanel } from "./PnlPanel";
import { PositionsPanel } from "./PositionsPanel";

function selectProposals(events: BotEvent[]): ArbProposal[] {
  return events.flatMap((e) => (e.type === "proposal" ? [e.proposal] : []));
}

function latestFillsById(events: BotEvent[]): Fill[] {
  const byId = new Map<string, Fill>();
  for (const e of events) {
    if (e.type !== "fill") continue;
    byId.set(e.fill.id, e.fill);
  }
  return Array.from(byId.values()).sort((a, b) => b.at - a.at);
}

function latestPolicyCap(events: BotEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "policy_parsed") return e.policy.maxTotal;
  }
  return 0;
}

export function Dashboard({ events }: { events: BotEvent[] }) {
  const proposals = selectProposals(events).slice(-8).reverse();
  const fills = latestFillsById(events).slice(0, 8);
  const cap = latestPolicyCap(events);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-ink p-4 scrollbar-thin">
      <PnlPanel events={events} capUsd={cap} />

      <Panel title="Open proposals" subtitle={`${proposals.length} most recent`}>
        {proposals.length === 0 ? (
          <Empty>no proposals yet · agent is scanning</Empty>
        ) : (
          <table className="w-full font-mono text-xs">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="py-2 text-left">time</th>
                <th className="text-left">cluster</th>
                <th className="text-right">EV</th>
                <th className="text-right">size</th>
                <th className="text-right">legs</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id} className="border-b border-line/30">
                  <td className="py-1.5 text-muted">{new Date(p.createdAt).toLocaleTimeString()}</td>
                  <td className="max-w-0 truncate text-white">{p.clusterLabel}</td>
                  <td className="text-right text-accent">{(p.evBps / 100).toFixed(2)}%</td>
                  <td className="text-right">${p.sizeUsd.toFixed(2)}</td>
                  <td className="text-right text-muted">{p.legs.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <PositionsPanel events={events} />

      <Panel title="Fills" subtitle={`${fills.length} most recent`}>
        {fills.length === 0 ? (
          <Empty>no fills yet · proposals route through non-custodial signer before execution</Empty>
        ) : (
          <table className="w-full font-mono text-xs">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="py-2 text-left">time</th>
                <th className="text-left">market</th>
                <th className="text-left">action</th>
                <th className="text-right">price</th>
                <th className="text-right">size</th>
                <th className="text-right">status</th>
              </tr>
            </thead>
            <tbody>
              {fills.map((f) => (
                <tr key={f.id} className="border-b border-line/30">
                  <td className="py-1.5 text-muted">{new Date(f.at).toLocaleTimeString()}</td>
                  <td className="font-mono text-xs">{f.conditionId.slice(0, 12)}…</td>
                  <td>
                    {f.action} {f.side}
                  </td>
                  <td className="text-right">{f.price.toFixed(3)}</td>
                  <td className="text-right">${f.sizeUsd.toFixed(2)}</td>
                  <td className={`text-right ${statusTone(f.status)}`}>{f.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function statusTone(status: Fill["status"]): string {
  if (status === "filled") return "text-accent";
  if (status === "pending") return "text-muted";
  return "text-danger";
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel">
      <div className="flex items-end justify-between border-b border-line px-4 py-2.5">
        <div className="font-mono text-sm text-accent">{title}</div>
        {subtitle && <div className="text-[10px] uppercase tracking-widest text-muted">{subtitle}</div>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-xs text-muted">{children}</div>;
}
