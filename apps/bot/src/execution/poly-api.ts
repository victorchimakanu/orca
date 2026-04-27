/**
 * Thin client for Polymarket CLOB order submission.
 *
 * We only need POST /order. Requires the EIP-712-signed order payload returned
 * by the aomi-transact skill + the user's signature.
 *
 * Note: the CLOB additionally requires L2 auth headers (API key + secret)
 * separate from the EIP-712 signature on the order itself. For the hackathon
 * demo we keep EXECUTION_MODE=dry so this is the sole call path that stays
 * mocked. The shape and contract are correct; wiring L2 auth is a one-hour
 * task post-hackathon if we decide to go live.
 */

import { buildL2Headers, getClobCreds } from "./clob-auth";

const CLOB_BASE = "https://clob.polymarket.com";
const ORDER_PATH = "/order";

export type PolymarketOrderPayload = {
  order: Record<string, unknown>; // the EIP-712 Order struct
  owner: string;                   // maker address
  orderType: "GTC" | "GTD" | "FOK" | "FAK";
  signature: string;               // 0x... from EIP-712
};

export async function submitOrder(payload: PolymarketOrderPayload): Promise<{ orderId: string | null; txHash: string | null; raw: unknown }> {
  const reqBody = JSON.stringify(payload);
  const baseHeaders: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "orca/0.1",
  };
  // Attach L2 auth when creds are hydrated. Without them CLOB returns 401;
  // the signer bridge is expected to handle the L2 handshake on first live
  // order (see execution/clob-auth.ts).
  const authHeaders = getClobCreds()
    ? buildL2Headers({ method: "POST", path: ORDER_PATH, body: reqBody })
    : {};
  const res = await fetch(`${CLOB_BASE}${ORDER_PATH}`, {
    method: "POST",
    headers: { ...baseHeaders, ...authHeaders },
    body: reqBody,
  });
  const respText = await res.text();
  if (!res.ok) {
    throw new Error(`CLOB /order ${res.status}: ${respText.slice(0, 300)}`);
  }
  const json = safeJson(respText);
  const orderId = typeof json?.orderID === "string" ? json.orderID : typeof json?.orderId === "string" ? json.orderId : null;
  const txHash = typeof json?.transactionHash === "string" ? json.transactionHash : null;
  return { orderId, txHash, raw: json };
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
