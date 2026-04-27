/**
 * Polymarket CLOB REST client (orderbook snapshots).
 *
 * M3 uses REST polling per scan cycle. M5 (optional) upgrades to the WebSocket
 * stream for lower latency. For a 30s scan cadence, REST is plenty.
 *
 * Each binary market has two ERC-1155 token IDs: clobTokenIds[0] = YES, [1] = NO.
 */

const CLOB_BASE = "https://clob.polymarket.com";
const CACHE_TTL_MS = 20_000;

type Book = {
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
};

type Level = { price: string; size: string };
type RawBook = {
  bids: Level[];
  asks: Level[];
};

const cache = new Map<string, { at: number; book: Book }>();

export type TopOfBook = {
  bestBid: number | null;
  bestAsk: number | null;
  depthUsd: number;
};

export async function fetchOrderbook(tokenId: string): Promise<Book> {
  const now = Date.now();
  const hit = cache.get(tokenId);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.book;

  const url = `${CLOB_BASE}/book?token_id=${encodeURIComponent(tokenId)}`;
  const res = await fetch(url, {
    headers: { "user-agent": "orca/0.1 (+hackathon)" },
  });
  if (!res.ok) {
    throw new Error(`CLOB ${res.status} for token=${tokenId.slice(0, 12)}…`);
  }
  const raw = (await res.json()) as RawBook;
  const book: Book = {
    bids: (raw.bids ?? []).map((l) => ({ price: Number(l.price), size: Number(l.size) })),
    asks: (raw.asks ?? []).map((l) => ({ price: Number(l.price), size: Number(l.size) })),
  };
  cache.set(tokenId, { at: now, book });
  return book;
}

/**
 * Extract top-of-book info suitable for our MarketSnapshot.
 *
 * Polymarket's CLOB orders the bids/asks by price such that:
 *   - bids are sorted ASCENDING (best bid = last element, highest price)
 *   - asks are sorted DESCENDING (best ask = last element, lowest price)
 *
 * Empirically this matches the live API (confirmed via the API research doc).
 * We don't hard-code direction — we take max(bids.price) and min(asks.price).
 */
export function topOfBook(book: Book, minDepthPrice = 0.02): TopOfBook {
  const bestBid = book.bids.reduce<number | null>((m, l) => (l.price > (m ?? 0) ? l.price : m), null);
  const bestAsk = book.asks.reduce<number | null>((m, l) => (m === null || l.price < m ? l.price : m), null);

  // Aggregate dollar depth at or near top of book (within `minDepthPrice` of the best)
  const bidDepth =
    bestBid === null
      ? 0
      : book.bids
          .filter((l) => l.price >= bestBid - minDepthPrice)
          .reduce((sum, l) => sum + l.price * l.size, 0);
  const askDepth =
    bestAsk === null
      ? 0
      : book.asks
          .filter((l) => l.price <= bestAsk + minDepthPrice)
          .reduce((sum, l) => sum + l.price * l.size, 0);

  return {
    bestBid,
    bestAsk,
    depthUsd: Math.min(bidDepth, askDepth),
  };
}
