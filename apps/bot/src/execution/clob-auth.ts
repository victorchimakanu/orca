/**
 * Polymarket CLOB L2 authentication helpers.
 *
 * Every POST to `clob.polymarket.com/order` requires *two* independent auth
 * artifacts:
 *
 *   1. The EIP-712 signature on the Order struct (handled in submit.ts + Para).
 *   2. L2 HMAC headers derived from an API key triple { apiKey, secret,
 *      passphrase } that's issued per-address after the user signs a seed
 *      message. See https://docs.polymarket.com/#authentication
 *
 * We treat L2 creds as a cache that the signer bridge hydrates lazily: on
 * first live order for a newly connected address, the bot returns a 428
 * PRECONDITION-style "need L2" response; the web app signs the L2 seed via
 * Para, creates the API key via CLOB `/auth/api-key`, and POSTs the triple
 * back to `/clob-auth`. After that orders flow freely until the process
 * restarts (or the user re-connects).
 *
 * For the hackathon this stays scaffolded — `EXECUTION_MODE=dry` skips the
 * whole path, and `EXECUTION_MODE=live` is only ever enabled for the $1 USDC
 * smoke test where you can wire the L2 handshake in one session.
 */

import crypto from "node:crypto";

export type ClobCreds = {
  apiKey: string;
  secret: string;
  passphrase: string;
  address: string;
};

let creds: ClobCreds | null = null;

export function setClobCreds(c: ClobCreds): void {
  creds = c;
}

export function getClobCreds(): ClobCreds | null {
  return creds;
}

export function clearClobCreds(): void {
  creds = null;
}

/**
 * Build the L2 HMAC headers CLOB expects on authenticated POSTs.
 * Spec: HMAC-SHA256 over `timestamp + method + path + body` using the
 * base64-decoded secret, then re-encoded base64.
 */
export function buildL2Headers(params: {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body: string;
}): Record<string, string> {
  if (!creds) throw new Error("no CLOB L2 creds; POST /clob-auth first");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = timestamp + params.method + params.path + (params.body ?? "");
  const key = Buffer.from(creds.secret, "base64");
  const sig = crypto.createHmac("sha256", key).update(message).digest("base64");
  return {
    "POLY_ADDRESS": creds.address,
    "POLY_API_KEY": creds.apiKey,
    "POLY_PASSPHRASE": creds.passphrase,
    "POLY_SIGNATURE": sig,
    "POLY_TIMESTAMP": timestamp,
  };
}
