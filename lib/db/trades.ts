import { getSql } from "@/lib/db"
import type { Trade } from "@/types"

const CACHE_TTL_HOURS = 24

/**
 * Returns true if the exchange has a fresh cache entry (within TTL).
 */
export async function isCacheFresh(telegramId: string, exchange: string): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    SELECT fetched_at FROM exchange_fetch_log
    WHERE telegram_id = ${BigInt(telegramId)}
      AND exchange = ${exchange}
      AND fetched_at > NOW() - INTERVAL '24 hours'
    LIMIT 1
  `
  return rows.length > 0
}

/**
 * Reads cached trades for a user+exchange from the DB.
 */
export async function getCachedTrades(telegramId: string, exchange: string): Promise<Trade[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, exchange, ticker, position_size, tp, sl, open_time, close_time, pnl, market
    FROM cached_trades
    WHERE telegram_id = ${BigInt(telegramId)}
      AND exchange = ${exchange}
    ORDER BY close_time DESC
  `
  return rows.map((r) => ({
    id: r.id as string,
    exchange: r.exchange as string,
    ticker: r.ticker as string,
    positionSize: Number(r.position_size),
    tp: r.tp != null ? Number(r.tp) : null,
    sl: r.sl != null ? Number(r.sl) : null,
    openTime: (r.open_time as Date).toISOString(),
    closeTime: (r.close_time as Date).toISOString(),
    pnl: Number(r.pnl),
    market: r.market as Trade["market"],
  }))
}

/**
 * Upserts a batch of trades and updates the fetch log timestamp.
 */
export async function upsertTrades(telegramId: string, exchange: string, trades: Trade[]): Promise<void> {
  const sql = getSql()
  const tid = BigInt(telegramId)

  if (trades.length > 0) {
    // Build values for bulk upsert
    for (const t of trades) {
      await sql`
        INSERT INTO cached_trades
          (id, telegram_id, exchange, ticker, position_size, tp, sl, open_time, close_time, pnl, market)
        VALUES (
          ${t.id}, ${tid}, ${t.exchange}, ${t.ticker},
          ${t.positionSize}, ${t.tp ?? null}, ${t.sl ?? null},
          ${t.openTime}::timestamptz, ${t.closeTime}::timestamptz,
          ${t.pnl}, ${t.market ?? null}
        )
        ON CONFLICT (telegram_id, id) DO UPDATE SET
          ticker        = EXCLUDED.ticker,
          position_size = EXCLUDED.position_size,
          tp            = EXCLUDED.tp,
          sl            = EXCLUDED.sl,
          open_time     = EXCLUDED.open_time,
          close_time    = EXCLUDED.close_time,
          pnl           = EXCLUDED.pnl,
          market        = EXCLUDED.market
      `
    }
  }

  await sql`
    INSERT INTO exchange_fetch_log (telegram_id, exchange, fetched_at)
    VALUES (${tid}, ${exchange}, NOW())
    ON CONFLICT (telegram_id, exchange) DO UPDATE SET fetched_at = NOW()
  `
}

/**
 * Deletes trades older than 2 years across all users.
 * Intended for cron cleanup.
 */
export async function deleteOldTrades(): Promise<number> {
  const sql = getSql()
  const result = await sql`
    DELETE FROM cached_trades
    WHERE close_time < NOW() - INTERVAL '2 years'
  `
  return result.length
}
