/**
 * Thin wrapper around the aomi-transact skill.
 *
 * The skill returns either an EIP-712 payload (most Polymarket orders — no gas)
 * or an EVM tx (USDC approvals, onchain settlements).
 *
 * We never import aomi-sdk directly. The boundary is: our bot describes intent
 * + provides the maker address + the CLOB tokenId, the skill + aomi-sdk +
 * Polymarket plugin produces the typed data. For the hackathon demo we inline
 * the struct-building here (it's ~30 lines of deterministic math that mirrors
 * `@polymarket/clob-client`'s `ExchangeOrderBuilder.buildOrderTypedData`). The
 * aomi-transact path remains available as the production hook and is selected
 * when `AOMI_TRANSACT=1` is set.
 */

import type { ArbProposal } from "@autopilot/shared-types";

export type AomiTxRequest =
  | {
      kind: "eip712";
      id: string;
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }
  | {
      kind: "tx";
      id: string;
      chainId: number;
      to: string;
      data: string;
      value: string;
    };

// Polymarket CTF Exchange on Polygon mainnet (non-negRisk markets).
const CTF_EXCHANGE_ADDRESS = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const POLYGON_CHAIN_ID = 137;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Signature types used by Polymarket's CTF Exchange.
//   0 = EOA (plain EIP-712)
//   1 = POLY_PROXY (browser wallet magic.link proxy)
//   2 = POLY_GNOSIS_SAFE (Safe-backed account)
const SIGNATURE_TYPE_EOA = 0;

const EIP712_DOMAIN = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

const ORDER_STRUCTURE = [
  { name: "salt", type: "uint256" },
  { name: "maker", type: "address" },
  { name: "signer", type: "address" },
  { name: "taker", type: "address" },
  { name: "tokenId", type: "uint256" },
  { name: "makerAmount", type: "uint256" },
  { name: "takerAmount", type: "uint256" },
  { name: "expiration", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "feeRateBps", type: "uint256" },
  { name: "side", type: "uint8" },
  { name: "signatureType", type: "uint8" },
];

export type OrderBuildContext = {
  /** Maker/signer EOA. Set via `POST /wallet` after Para connects. */
  maker: string | null;
  /** CLOB tokenId for this leg's outcome (YES or NO). Populated from the scanner's market snapshot. */
  tokenId: string | null;
  /** Optional on-chain fee rate. Defaults to 0 bps. */
  feeRateBps?: number;
};

/**
 * Build a Polymarket limit order.
 *
 * When `ctx.maker` and `ctx.tokenId` are both present we emit a *real* CTF
 * Exchange Order that Polymarket's CLOB will accept (assuming a valid
 * signature later). Otherwise we emit the legacy demo envelope — the click
 * and mock signer modes inspect `message` only for preview purposes and don't
 * care about the on-wire struct.
 */
export async function buildPolymarketOrder(
  proposal: ArbProposal,
  legIndex: number,
  ctx: OrderBuildContext = { maker: null, tokenId: null },
): Promise<AomiTxRequest> {
  const leg = proposal.legs[legIndex];
  if (!leg) throw new Error(`leg ${legIndex} out of range`);

  const id = `${proposal.id}:${legIndex}`;
  const domain = {
    name: "Polymarket CTF Exchange",
    version: "1",
    chainId: POLYGON_CHAIN_ID,
    verifyingContract: CTF_EXCHANGE_ADDRESS,
  };
  const types = { EIP712Domain: EIP712_DOMAIN, Order: ORDER_STRUCTURE };

  // Demo path: maker or tokenId missing → envelope for mock/click signer.
  if (!ctx.maker || !ctx.tokenId) {
    return {
      kind: "eip712",
      id,
      domain,
      types,
      primaryType: "Order",
      message: {
        conditionId: leg.conditionId,
        side: leg.side,
        action: leg.action,
        price: leg.price,
        sizeUsd: leg.sizeUsd,
        mock: true,
      },
    };
  }

  // Live path: real CTF Order struct.
  const message = buildCtfOrderMessage(leg, ctx.maker, ctx.tokenId, ctx.feeRateBps ?? 0);
  return { kind: "eip712", id, domain, types, primaryType: "Order", message };
}

function buildCtfOrderMessage(
  leg: ArbProposal["legs"][number],
  maker: string,
  tokenId: string,
  feeRateBps: number,
): Record<string, unknown> {
  const price = clampPrice(leg.price);
  const usdcAmount = toMicrounits(leg.sizeUsd);            // USDC (6 decimals)
  const tokenAmount = toMicrounits(leg.sizeUsd / price);   // CTF outcome token (6 decimals, $1/token at resolution)

  // Polymarket's Side encoding: BUY = 0, SELL = 1.
  // BUY: makerAmount = USDC we put up, takerAmount = outcome tokens we expect.
  // SELL: makerAmount = outcome tokens we offer, takerAmount = USDC we want back.
  const side = leg.action === "BUY" ? 0 : 1;
  const makerAmount = leg.action === "BUY" ? usdcAmount : tokenAmount;
  const takerAmount = leg.action === "BUY" ? tokenAmount : usdcAmount;

  return {
    salt: generateOrderSalt(),
    maker,
    signer: maker,
    taker: ZERO_ADDRESS,      // public order — any taker can fill
    tokenId,
    makerAmount: makerAmount.toString(),
    takerAmount: takerAmount.toString(),
    expiration: "0",           // GTC
    nonce: "0",                // per-maker nonce; 0 is fine unless caller uses cancel-all
    feeRateBps: feeRateBps.toString(),
    side,
    signatureType: SIGNATURE_TYPE_EOA,
  };
}

function clampPrice(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return 0.0001;
  if (p >= 1) return 0.9999;
  return p;
}

// USDC + Polymarket CTF outcome tokens both use 6 decimals.
function toMicrounits(amountUsd: number): bigint {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return 0n;
  // Round to 6 decimal places, then scale.
  const rounded = Math.round(amountUsd * 1_000_000);
  return BigInt(rounded);
}

// 256-bit random salt (decimal string). Matches clob-client semantics.
function generateOrderSalt(): string {
  const bytes = new Uint8Array(32);
  // crypto is globally available in Bun + Node 20+.
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex).toString(10);
}
