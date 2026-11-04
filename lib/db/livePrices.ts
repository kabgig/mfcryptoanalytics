/**
 * Global live-price cache (Coinbase/Kraken) in Neon.
 *
 * Live prices are identical for every user, so a row here serves the whole
 * app: /api/spot/prices only asks the upstream for tickers whose cached value
 * is older than the route's TTL. This is the "one user refreshes, everyone
 * reads" pattern — on serverless the shared table, not instance memory, is
 * what makes it global.
 */
import { getSql } from "@/lib/db"

/**
 * How long a live price serves before the next request may refresh it. Kept
 * here rather than in the route file because Next.js forbids extra exports
 * from route modules.
 */
export const LIVE_PRICE_TTL_MS = 60_000

export interface LivePrice {
  price: number
  fetchedAt: Date
}

/** Cached live prices for the given tickers. Missing ones are absent. */
export async function getLivePrices(
  tickers: string[]
): Promise<Record<string, LivePrice>> {
  const out: Record<string, LivePrice> = {}
  if (tickers.length === 0) return out
  const sql = getSql()
  const rows = (await sql`
    SELECT ticker, price, fetched_at
    FROM public.live_prices
    WHERE ticker = ANY(${tickers})
  `) as { ticker: string; price: number; fetched_at: Date }[]
  for (const r of rows) out[r.ticker] = { price: Number(r.price), fetchedAt: r.fetched_at }
  return out
}

/** Upserts freshly fetched prices; `fetched_at` is set by the database. */
export async function upsertLivePrices(
  rows: Array<{ ticker: string; price: number }>
): Promise<void> {
  if (rows.length === 0) return
  const sql = getSql()
  const tickers = rows.map((r) => r.ticker)
  const prices = rows.map((r) => r.price)
  await sql`
    INSERT INTO public.live_prices (ticker, price, fetched_at)
    SELECT t, p, NOW()
    FROM unnest(${tickers}::text[], ${prices}::float8[]) AS x(t, p)
    ON CONFLICT (ticker) DO UPDATE SET
      price      = EXCLUDED.price,
      fetched_at = NOW()
  `
}
