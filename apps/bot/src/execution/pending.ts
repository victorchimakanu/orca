/**
 * In-memory pending-signatures map.
 *
 * When the orchestrator emits a `wallet_eip712_request` / `wallet_tx_request`
 * over SSE it stores a deferred promise here. The widget's signer bridge POSTs
 * back to `/sign` with the signed payload; we resolve the corresponding
 * promise. Default timeout: 60s, after which the promise rejects and the
 * execution pipeline moves on.
 */

import type { SignedPayload } from "@autopilot/shared-types";

type Pending = {
  resolve: (p: SignedPayload) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();

export function awaitSignature(id: string, timeoutMs = 60_000): Promise<SignedPayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`signature timeout for ${id}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
  });
}

export function resolveSignature(payload: SignedPayload): boolean {
  const slot = pending.get(payload.id);
  if (!slot) return false;
  clearTimeout(slot.timer);
  pending.delete(payload.id);
  slot.resolve(payload);
  return true;
}

export function cancelAll(reason = "halted"): void {
  for (const [id, slot] of pending) {
    clearTimeout(slot.timer);
    slot.reject(new Error(reason));
    pending.delete(id);
  }
}

export function pendingCount(): number {
  return pending.size;
}
