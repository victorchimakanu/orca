/**
 * Para configuration, resolved from NEXT_PUBLIC_* env vars.
 *
 * Para is the non-custodial session signer — an MPC service that co-signs
 * within a user-authorized envelope (per-trade cap, total cap, expiry). The
 * master key never leaves Para's enclave.
 *
 * When NEXT_PUBLIC_SIGNER_MODE !== "live" these values are never read. The
 * demo default (mock/click) does not require a Para account.
 */

export const PARA_API_KEY = process.env.NEXT_PUBLIC_PARA_API_KEY ?? "";
export const PARA_ENV = (process.env.NEXT_PUBLIC_PARA_ENV as "BETA" | "PROD" | undefined) ?? "BETA";
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Orca";
// Polymarket CTF Exchange is on Polygon mainnet (137).
export const POLYGON_CHAIN_ID = 137;
export const POLYGON_RPC = process.env.NEXT_PUBLIC_POLYGON_RPC ?? "https://polygon-rpc.com";
