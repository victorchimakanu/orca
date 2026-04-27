"use client";

import type { BotEvent, PnlSnapshot } from "@autopilot/shared-types";
import { useMemo } from "react";

export function PnlPanel({ events, capUsd }: { events: BotEvent[]; capUsd: number }) {
  const snapshots = useMemo(() => selectSnapshots(events), [events]);
  const latest = snapshots[snapshots.length - 1];

  const deployed = latest?.deployedUsd ?? 0;
  const unreal = latest?.unrealizedUsd ?? 0;
  const deployedPct = capUsd > 0 ? Math.min(100, (deployed / capUsd) * 100) : 0;

  return (
    <div className="rounded-lg border border-line bg-panel">
      <div className="flex items-end justify-between border-b border-line px-4 py-2.5">
        <div className="font-mono text-sm text-accent">pnl & deployed capital</div>
        <div className="text-[10px] uppercase tracking-widest text-muted">
          {snapshots.length} samples
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 px-4 py-3">
        <Stat label="deployed" value={`$${deployed.toFixed(2)} / $${capUsd.toFixed(0)}`} sub={`${deployedPct.toFixed(0)}% of cap`} />
        <Stat label="unrealized" value={`${unreal >= 0 ? "+" : ""}$${unreal.toFixed(2)}`} tone={unreal >= 0 ? "accent" : "danger"} />
        <Stat label="realized" value={`$${(latest?.realizedUsd ?? 0).toFixed(2)}`} sub="closes on M5" />
      </div>
      <div className="border-t border-line px-4 py-3">
        <Sparkline snapshots={snapshots} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "accent" | "danger";
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted">{label}</div>
      <div className={`font-mono text-lg ${tone === "accent" ? "text-accent" : tone === "danger" ? "text-danger" : "text-white"}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

function Sparkline({ snapshots }: { snapshots: PnlSnapshot[] }) {
  if (snapshots.length < 2) {
    return <div className="py-2 text-center text-[10px] text-muted">collecting data…</div>;
  }
  const W = 600;
  const H = 48;
  const ys = snapshots.map((s) => s.unrealizedUsd);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(0, ...ys);
  const range = Math.max(0.01, yMax - yMin);
  const path = snapshots
    .map((s, i) => {
      const x = (i / (snapshots.length - 1)) * W;
      const y = H - ((s.unrealizedUsd - yMin) / range) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const zeroY = H - ((0 - yMin) / range) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-full">
      <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="currentColor" strokeDasharray="2 3" className="text-line" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent" />
    </svg>
  );
}

function selectSnapshots(events: BotEvent[]): PnlSnapshot[] {
  return events.flatMap((e) => (e.type === "pnl" ? [e.snapshot] : []));
}
