import { z } from "zod";

// ── Policy ────────────────────────────────────────────────────────────────
export const PolicySchema = z.object({
  id: z.string(),
  rawText: z.string(),
  topics: z.array(z.string()).describe("Topics / tags to filter Polymarket by, e.g. ['trump', 'election-2024']"),
  minEV: z.number().min(0).max(1).describe("Minimum expected-value edge as a fraction, e.g. 0.03 = 3%"),
  minLiquidityPerSide: z.number().min(0).describe("Minimum orderbook depth in USDC required on both sides to consider an arb"),
  maxPerTrade: z.number().min(0).describe("Max USDC deployed per individual fill"),
  maxTotal: z.number().min(0).describe("Cumulative USDC cap; once hit, agent halts"),
  expiresAt: z.number().describe("Unix ms when session authorization expires"),
  hardStops: z.array(z.string()).describe("Free-form conditions that force a halt, e.g. 'pause if I lose 10%'"),
  createdAt: z.number(),
});
export type Policy = z.infer<typeof PolicySchema>;

// ── Market snapshot ───────────────────────────────────────────────────────
export const MarketSnapshotSchema = z.object({
  conditionId: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  yesBestBid: z.number().nullable(),
  yesBestAsk: z.number().nullable(),
  noBestBid: z.number().nullable(),
  noBestAsk: z.number().nullable(),
  liquidityUsd: z.number(),
  updatedAt: z.number(),
  yesTokenId: z.string().optional().describe("Polymarket CLOB tokenId for the YES outcome (required for live execution)"),
  noTokenId: z.string().optional().describe("Polymarket CLOB tokenId for the NO outcome (required for live execution)"),
});
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;

// ── Reasoning trace ───────────────────────────────────────────────────────
export const ConstraintSchema = z.object({
  relation: z.enum(["subset", "disjoint", "implies", "mutex"]),
  markets: z.array(z.string()).describe("Condition IDs involved in this logical relationship"),
  explanation: z.string().describe("Short natural-language justification"),
});
export type Constraint = z.infer<typeof ConstraintSchema>;

export const ArbProposalSchema = z.object({
  id: z.string(),
  clusterLabel: z.string(),
  constraint: ConstraintSchema,
  evBps: z.number().describe("Expected value in basis points (100 = 1%)"),
  sizeUsd: z.number(),
  legs: z.array(
    z.object({
      conditionId: z.string(),
      side: z.enum(["YES", "NO"]),
      action: z.enum(["BUY", "SELL"]),
      price: z.number(),
      sizeUsd: z.number(),
    }),
  ),
  createdAt: z.number(),
});
export type ArbProposal = z.infer<typeof ArbProposalSchema>;

export const ReasoningTraceSchema = z.object({
  id: z.string(),
  at: z.number(),
  kind: z.enum(["cluster", "constraint", "proposal", "rejection", "fill", "execution"]),
  clusterLabel: z.string().nullable(),
  summary: z.string(),
  detail: z.unknown().optional(),
});
export type ReasoningTrace = z.infer<typeof ReasoningTraceSchema>;

// ── Fill ──────────────────────────────────────────────────────────────────
export const FillSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  txHash: z.string().nullable(),
  orderId: z.string().nullable(),
  conditionId: z.string(),
  side: z.enum(["YES", "NO"]),
  action: z.enum(["BUY", "SELL"]),
  price: z.number(),
  sizeUsd: z.number(),
  status: z.enum(["pending", "filled", "cancelled", "failed"]),
  at: z.number(),
});
export type Fill = z.infer<typeof FillSchema>;

// ── Position ──────────────────────────────────────────────────────────────
export const PositionSchema = z.object({
  conditionId: z.string(),
  title: z.string(),
  side: z.enum(["YES", "NO"]),
  netSizeUsd: z.number().describe("Net USDC deployed (BUY positive, SELL negative)"),
  avgPrice: z.number().describe("Size-weighted average fill price"),
  lastPrice: z.number().nullable().describe("Most recent mark price"),
  unrealizedUsd: z.number(),
  updatedAt: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;

// ── PnL snapshot ──────────────────────────────────────────────────────────
export const PnlSnapshotSchema = z.object({
  at: z.number(),
  realizedUsd: z.number(),
  unrealizedUsd: z.number(),
  deployedUsd: z.number(),
});
export type PnlSnapshot = z.infer<typeof PnlSnapshotSchema>;

// ── Wallet signing envelope ───────────────────────────────────────────────
// Shape mirrors the aomi-widget wallet_eip712_request event bus payload.
export const WalletEip712RequestSchema = z.object({
  id: z.string(),
  domain: z.unknown(),
  types: z.unknown(),
  primaryType: z.string(),
  message: z.unknown(),
});
export type WalletEip712Request = z.infer<typeof WalletEip712RequestSchema>;

export const WalletTxRequestSchema = z.object({
  id: z.string(),
  chainId: z.number(),
  to: z.string(),
  data: z.string(),
  value: z.string(),
});
export type WalletTxRequest = z.infer<typeof WalletTxRequestSchema>;

export const SignedPayloadSchema = z.object({
  id: z.string().describe("Matches the wallet_*_request id"),
  kind: z.enum(["eip712", "tx"]),
  signature: z.string().describe("0x-prefixed hex; for EIP-712 this is the order signature"),
  signerAddress: z.string(),
  txHash: z.string().nullable().optional().describe("If kind=tx and already broadcast, the Polygon tx hash"),
});
export type SignedPayload = z.infer<typeof SignedPayloadSchema>;

// ── SSE event bus envelope ────────────────────────────────────────────────
export type BotEvent =
  | { type: "policy_parsed"; policy: Policy }
  | { type: "reasoning"; trace: ReasoningTrace }
  | { type: "proposal"; proposal: ArbProposal }
  | { type: "wallet_tx_request"; id: string; proposalId: string; legIndex: number; chainId: number; to: string; data: string; value: string }
  | { type: "wallet_eip712_request"; id: string; proposalId: string; legIndex: number; domain: unknown; types: unknown; message: unknown; primaryType: string }
  | { type: "fill"; fill: Fill }
  | { type: "position"; position: Position }
  | { type: "pnl"; snapshot: PnlSnapshot }
  | { type: "halt"; reason: string };
