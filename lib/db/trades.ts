import { getSql } from "@/lib/db"
import type { Trade } from "@/types"

function rowToTrade(r: Record<string, unknown>): Trade {
  return {
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
    side: (r.side as Trade["side"]) ?? undefined,
  }
}

/**
 * Single-query: checks freshness AND returns cached trades together.
 * Returns { fresh: true, trades } if cache is valid, or { fresh: false } if not.
 */
export async function getIfFresh(
  telegramId: string,
  exchange: string
): Promise<{ fresh: true; trades: Trade[] } | { fresh: false }> {
  const sql = getSql()
  // LEFT JOIN: if efl row exists & is fresh, ct rows are returned (even if 0 trades stored).
  // If efl row missing or stale, 0 rows returned.
  const rows = await sql`
    SELECT ct.id, ct.exchange, ct.ticker, ct.position_size, ct.tp, ct.sl,
           ct.open_time, ct.close_time, ct.pnl, ct.market, ct.side,
           efl.fetched_at
    FROM exchange_fetch_log efl
    LEFT JOIN cached_trades ct
      ON ct.telegram_id = efl.telegram_id
     AND ct.exchange    = efl.exchange
    WHERE efl.telegram_id = ${BigInt(telegramId)}
      AND efl.exchange    = ${exchange}
      AND efl.fetched_at  > NOW() - INTERVAL '24 hours'
    ORDER BY ct.close_time DESC
  ` as Record<string, unknown>[]

  if (rows.length === 0) return { fresh: false }

  // Filter out the sentinel NULL row (fresh log but 0 trades)
  const trades = rows.filter((r) => r.id != null).map(rowToTrade)
  return { fresh: true, trades }
}

/**
 * @deprecated Use getIfFresh instead
 */
export async function isCacheFresh(telegramId: string, exchange: string): Promise<boolean> {
  const result = await getIfFresh(telegramId, exchange)
  return result.fresh
}

/**
 * @deprecated Use getIfFresh instead
 */
export async function getCachedTrades(telegramId: string, exchange: string): Promise<Trade[]> {
  const result = await getIfFresh(telegramId, exchange)
  return result.fresh ? result.trades : []
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
          (id, telegram_id, exchange, ticker, position_size, tp, sl, open_time, close_time, pnl, market, side)
        VALUES (
          ${t.id}, ${tid}, ${t.exchange}, ${t.ticker},
          ${t.positionSize}, ${t.tp ?? null}, ${t.sl ?? null},
          ${t.openTime}::timestamptz, ${t.closeTime}::timestamptz,
          ${t.pnl}, ${t.market ?? null}, ${t.side ?? null}
        )
        ON CONFLICT (telegram_id, id) DO UPDATE SET
          ticker        = EXCLUDED.ticker,
          position_size = EXCLUDED.position_size,
          tp            = EXCLUDED.tp,
          sl            = EXCLUDED.sl,
          open_time     = EXCLUDED.open_time,
          close_time    = EXCLUDED.close_time,
          pnl           = EXCLUDED.pnl,
          market        = EXCLUDED.market,
          side          = EXCLUDED.side
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
  ` as Record<string, unknown>[]
  return result.length
}
