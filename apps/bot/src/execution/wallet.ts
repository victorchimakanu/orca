/**
 * In-memory cache of the user's connected wallet address.
 *
 * The web app POSTs here after Para (or any other signer in `live` mode)
 * finishes connecting. The execution layer reads this when building real
 * EIP-712 orders — without a connected address, live orders can't be built
 * and we fall back to the mock envelope that the click/mock signer accepts.
 *
 * Scope: one process, one user. Cleared on /kill and on process restart.
 */

let currentAddress: string | null = null;
let connectedAt: number | null = null;

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export function setWalletAddress(addr: string): { ok: boolean; error?: string } {
  if (!ADDR_RE.test(addr)) return { ok: false, error: "invalid 0x-address" };
  currentAddress = addr.toLowerCase();
  connectedAt = Date.now();
  return { ok: true };
}

export function getWalletAddress(): string | null {
  return currentAddress;
}

export function getWalletInfo(): { address: string | null; connectedAt: number | null } {
  return { address: currentAddress, connectedAt };
}

export function clearWallet(): void {
  currentAddress = null;
  connectedAt = null;
}
