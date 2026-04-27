"use client";

import type { BotEvent, Position } from "@autopilot/shared-types";
import { useMemo } from "react";

export function PositionsPanel({ events }: { events: BotEvent[] }) {
  const positions = useMemo(() => latestPositions(events), [events]);

  return (
    <div className="rounded-lg border border-line bg-panel">
      <div className="flex items-end justify-between border-b border-line px-4 py-2.5">
        <div className="font-mono text-sm text-accent">positions</div>
        <div className="text-[10px] uppercase tracking-widest text-muted">{positions.length} open</div>
      </div>
      <div className="px-4 py-3">
        {positions.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted">no positions yet</div>
        ) : (
          <table className="w-full font-mono text-xs">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="py-2 text-left">market</th>
                <th className="text-left">side</th>
                <th className="text-right">size</th>
                <th className="text-right">avg</th>
                <th className="text-right">mark</th>
                <th className="text-right">pnl</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={`${p.conditionId}:${p.side}`} className="border-b border-line/30">
                  <td className="max-w-0 truncate py-1.5 text-white">{p.title}</td>
                  <td>{p.side}</td>
                  <td className="text-right">${p.netSizeUsd.toFixed(2)}</td>
                  <td className="text-right">{p.avgPrice.toFixed(3)}</td>
                  <td className="text-right text-muted">{p.lastPrice === null ? "—" : p.lastPrice.toFixed(3)}</td>
                  <td className={`text-right ${p.unrealizedUsd >= 0 ? "text-accent" : "text-danger"}`}>
                    {p.unrealizedUsd >= 0 ? "+" : ""}${p.unrealizedUsd.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function latestPositions(events: BotEvent[]): Position[] {
  const byKey = new Map<string, Position>();
  for (const e of events) {
    if (e.type !== "position") continue;
    byKey.set(`${e.position.conditionId}:${e.position.side}`, e.position);
  }
  return Array.from(byKey.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}
