/**
 * SQLite-backed persistence for proposals, fills, positions, and PnL snapshots.
 *
 * Why SQLite: single-file, zero setup, durable across restarts. Bun ships
 * `bun:sqlite` built in so no native build step.
 *
 * Schema notes:
 *  - `proposals` logs EVERY proposal the pipeline produces, even rejected ones,
 *    with a reason string. This is the audit log the dashboard displays.
 *  - `fills` rows are append-only; a fill's status moves pending → filled /
 *    failed / cancelled via updates but never deleted.
 *  - `positions` is recomputed from fills on demand; we don't maintain it
 *    transactionally. Rebuilding from 50-100 fills is microseconds.
 *  - `snapshots` is a ring of mark-to-market points for the PnL sparkline.
 */

import { Database } from "bun:sqlite";
import type { ArbProposal, Fill, PnlSnapshot, Policy } from "@autopilot/shared-types";

const DB_PATH = process.env.BOT_DB_PATH ?? "./data/bot.db";

let dbCache: Database | null = null;
function db(): Database {
  if (dbCache) return dbCache;
  // Ensure parent dir exists.
  try {
    const dir = DB_PATH.includes("/") ? DB_PATH.slice(0, DB_PATH.lastIndexOf("/")) : ".";
    if (dir && dir !== ".") Bun.spawnSync(["mkdir", "-p", dir]);
  } catch {}
  const d = new Database(DB_PATH, { create: true });
  d.exec("PRAGMA journal_mode = WAL");
  d.exec(SCHEMA);
  dbCache = d;
  return d;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  policy_id TEXT,
  cluster_label TEXT NOT NULL,
  ev_bps INTEGER NOT NULL,
  size_usd REAL NOT NULL,
  json TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'accepted' | 'rejected'
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fills (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  tx_hash TEXT,
  order_id TEXT,
  condition_id TEXT NOT NULL,
  title TEXT NOT NULL,
  side TEXT NOT NULL,        -- 'YES' | 'NO'
  action TEXT NOT NULL,      -- 'BUY' | 'SELL'
  price REAL NOT NULL,
  size_usd REAL NOT NULL,
  status TEXT NOT NULL,      -- 'pending' | 'filled' | 'cancelled' | 'failed'
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fills_status ON fills(status);
CREATE INDEX IF NOT EXISTS idx_fills_condition ON fills(condition_id);

CREATE TABLE IF NOT EXISTS snapshots (
  at INTEGER PRIMARY KEY,
  realized_usd REAL NOT NULL,
  unrealized_usd REAL NOT NULL,
  deployed_usd REAL NOT NULL
);
`;

export function savePolicy(p: Policy): void {
  db()
    .prepare(`INSERT OR REPLACE INTO policies (id, raw_text, json, created_at) VALUES (?, ?, ?, ?)`)
    .run(p.id, p.rawText, JSON.stringify(p), p.createdAt);
}

export function saveProposal(p: ArbProposal, policyId: string | null, status: "accepted" | "rejected", reason: string | null): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO proposals (id, policy_id, cluster_label, ev_bps, size_usd, json, status, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(p.id, policyId, p.clusterLabel, p.evBps, p.sizeUsd, JSON.stringify(p), status, reason, p.createdAt);
}

export function recordFill(f: Fill, title: string): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO fills (id, proposal_id, tx_hash, order_id, condition_id, title, side, action, price, size_usd, status, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      f.id,
      f.proposalId,
      f.txHash,
      f.orderId,
      f.conditionId,
      title,
      f.side,
      f.action,
      f.price,
      f.sizeUsd,
      f.status,
      f.at,
    );
}

export function updateFillStatus(
  id: string,
  status: Fill["status"],
  opts: { txHash?: string | null; orderId?: string | null } = {},
): void {
  db()
    .prepare(`UPDATE fills SET status = ?, tx_hash = COALESCE(?, tx_hash), order_id = COALESCE(?, order_id) WHERE id = ?`)
    .run(status, opts.txHash ?? null, opts.orderId ?? null, id);
}

export function deployedUsd(): number {
  const row = db()
    .prepare(`SELECT COALESCE(SUM(size_usd), 0) AS total FROM fills WHERE status IN ('pending', 'filled') AND action = 'BUY'`)
    .get() as { total: number };
  return row.total;
}

export function listFills(limit = 100): Array<Fill & { title: string }> {
  const rows = db()
    .prepare(`SELECT * FROM fills ORDER BY at DESC LIMIT ?`)
    .all(limit) as Array<{
      id: string;
      proposal_id: string;
      tx_hash: string | null;
      order_id: string | null;
      condition_id: string;
      title: string;
      side: "YES" | "NO";
      action: "BUY" | "SELL";
      price: number;
      size_usd: number;
      status: Fill["status"];
      at: number;
    }>;
  return rows.map((r) => ({
    id: r.id,
    proposalId: r.proposal_id,
    txHash: r.tx_hash,
    orderId: r.order_id,
    conditionId: r.condition_id,
    title: r.title,
    side: r.side,
    action: r.action,
    price: r.price,
    sizeUsd: r.size_usd,
    status: r.status,
    at: r.at,
  }));
}

export function saveSnapshot(s: PnlSnapshot): void {
  db()
    .prepare(`INSERT OR REPLACE INTO snapshots (at, realized_usd, unrealized_usd, deployed_usd) VALUES (?, ?, ?, ?)`)
    .run(s.at, s.realizedUsd, s.unrealizedUsd, s.deployedUsd);
}

export function listSnapshots(limit = 200): PnlSnapshot[] {
  const rows = db()
    .prepare(`SELECT at, realized_usd, unrealized_usd, deployed_usd FROM snapshots ORDER BY at DESC LIMIT ?`)
    .all(limit) as Array<{ at: number; realized_usd: number; unrealized_usd: number; deployed_usd: number }>;
  return rows
    .map((r) => ({ at: r.at, realizedUsd: r.realized_usd, unrealizedUsd: r.unrealized_usd, deployedUsd: r.deployed_usd }))
    .reverse();
}
