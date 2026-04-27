/**
 * Execution orchestrator. For each leg of an approved arb proposal:
 *
 *   1. Have aomi-transact build the EIP-712 order payload.
 *   2. Emit `wallet_eip712_request` over SSE. This is the non-custodial boundary —
 *      the master key never lives in this process.
 *   3. Wait (up to 60s) for the signer bridge to POST the signature back to
 *      `/sign`.
 *   4. In EXECUTION_MODE=live, submit to Polymarket CLOB.
 *      In dry mode (default), synthesize a mock orderId + tx hash and mark
 *      the fill as `filled` so the downstream tracker updates.
 *   5. Persist the fill; publish `fill` + `position` events for the dashboard.
 *
 * Cap enforcement lives HERE (not in arb.ts) because the cap is enforced
 * against the SQLite-backed deployed-capital counter — state that only the
 * orchestrator sees.
 */

import type { ArbProposal, Fill, MarketSnapshot, Policy } from "@autopilot/shared-types";
import { buildPolymarketOrder } from "@autopilot/aomi-bridge";
import { bus } from "../events/bus";
import { awaitSignature } from "./pending";
import { submitOrder } from "./poly-api";
import { getWalletAddress } from "./wallet";
import { deployedUsd, recordFill, saveProposal, updateFillStatus } from "../tracker/db";

const SIGNATURE_TIMEOUT_MS = Number(process.env.SIGNATURE_TIMEOUT_MS ?? 60_000);

export type ExecutionResult =
  | { kind: "ok"; fills: Fill[] }
  | { kind: "cap_exceeded"; deployed: number; sizeUsd: number; cap: number }
  | { kind: "signature_timeout"; legIndex: number }
  | { kind: "submit_failed"; legIndex: number; error: string };

export async function executeProposal(
  proposal: ArbProposal,
  policy: Policy,
  titleByConditionId: Map<string, string>,
  marketByConditionId: Map<string, MarketSnapshot>,
): Promise<ExecutionResult> {
  // ── Cap enforcement ──────────────────────────────────────────────────────
  const deployed = deployedUsd();
  const needed = proposal.legs
    .filter((l) => l.action === "BUY")
    .reduce((n, l) => n + l.sizeUsd, 0);
  if (deployed + needed > policy.maxTotal) {
    saveProposal(proposal, policy.id, "rejected", `cap: deployed=$${deployed.toFixed(2)} + needed=$${needed.toFixed(2)} > $${policy.maxTotal}`);
    return { kind: "cap_exceeded", deployed, sizeUsd: needed, cap: policy.maxTotal };
  }

  saveProposal(proposal, policy.id, "accepted", null);

  const fills: Fill[] = [];
  const maker = getWalletAddress();
  for (let i = 0; i < proposal.legs.length; i++) {
    const leg = proposal.legs[i]!;
    const market = marketByConditionId.get(leg.conditionId);
    const tokenId = leg.side === "YES" ? market?.yesTokenId ?? null : market?.noTokenId ?? null;
    const req = await buildPolymarketOrder(proposal, i, { maker, tokenId });

    // Emit the sign request. The widget's signer bridge POSTs the signature to /sign.
    if (req.kind === "eip712") {
      bus.publish({
        type: "wallet_eip712_request",
        id: req.id,
        proposalId: proposal.id,
        legIndex: i,
        domain: req.domain,
        types: req.types,
        primaryType: req.primaryType,
        message: req.message,
      });
    } else {
      bus.publish({
        type: "wallet_tx_request",
        id: req.id,
        proposalId: proposal.id,
        legIndex: i,
        chainId: req.chainId,
        to: req.to,
        data: req.data,
        value: req.value,
      });
    }

    // Record the fill as pending immediately so cap tracking picks it up.
    const fill: Fill = {
      id: req.id,
      proposalId: proposal.id,
      txHash: null,
      orderId: null,
      conditionId: leg.conditionId,
      side: leg.side,
      action: leg.action,
      price: leg.price,
      sizeUsd: leg.sizeUsd,
      status: "pending",
      at: Date.now(),
    };
    const title = titleByConditionId.get(leg.conditionId) ?? leg.conditionId.slice(0, 10);
    recordFill(fill, title);
    bus.publish({ type: "fill", fill });

    // Wait for the signature.
    let signed;
    try {
      signed = await awaitSignature(req.id, SIGNATURE_TIMEOUT_MS);
    } catch (err) {
      updateFillStatus(fill.id, "cancelled");
      bus.publish({ type: "fill", fill: { ...fill, status: "cancelled" } });
      return { kind: "signature_timeout", legIndex: i };
    }

    // Submit (live) or simulate (dry).
    const mode = process.env.EXECUTION_MODE ?? "dry";
    if (mode === "live" && req.kind === "eip712") {
      try {
        const result = await submitOrder({
          order: req.message as Record<string, unknown>,
          owner: signed.signerAddress,
          orderType: "FOK",
          signature: signed.signature,
        });
        updateFillStatus(fill.id, "filled", { orderId: result.orderId, txHash: result.txHash });
        const finalized: Fill = { ...fill, status: "filled", orderId: result.orderId, txHash: result.txHash };
        fills.push(finalized);
        bus.publish({ type: "fill", fill: finalized });
      } catch (err) {
        updateFillStatus(fill.id, "failed");
        const msg = err instanceof Error ? err.message : String(err);
        bus.publish({ type: "fill", fill: { ...fill, status: "failed" } });
        return { kind: "submit_failed", legIndex: i, error: msg };
      }
    } else {
      // Dry mode: synthesize fill.
      const mockOrderId = `dry-${Date.now()}-${i}`;
      const mockTxHash = signed.txHash ?? null;
      updateFillStatus(fill.id, "filled", { orderId: mockOrderId, txHash: mockTxHash });
      const finalized: Fill = { ...fill, status: "filled", orderId: mockOrderId, txHash: mockTxHash };
      fills.push(finalized);
      bus.publish({ type: "fill", fill: finalized });
    }
  }

  return { kind: "ok", fills };
}
