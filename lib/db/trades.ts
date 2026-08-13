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
 * Returns all stored trades for a user+exchange with no freshness check.
 * Used for manual imports (e.g. Jupiter Perps) that never expire.
 */
export async function getStoredTrades(telegramId: string, exchange: string): Promise<Trade[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, exchange, ticker, position_size, tp, sl,
           open_time, close_time, pnl, market, side
    FROM cached_trades
    WHERE telegram_id = ${BigInt(telegramId)}
      AND exchange    = ${exchange}
      AND deleted_at IS NULL
    ORDER BY close_time DESC
  ` as Record<string, unknown>[]
  return rows.map(rowToTrade)
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
  // The soft-delete filter belongs in the JOIN condition, NOT the WHERE clause: in
  // WHERE it would drop the sentinel NULL row too, so a user whose trades are all
  // deleted would read as "not fresh" and re-hit the exchange on every page load.
  const rows = await sql`
    SELECT ct.id, ct.exchange, ct.ticker, ct.position_size, ct.tp, ct.sl,
           ct.open_time, ct.close_time, ct.pnl, ct.market, ct.side,
           efl.fetched_at
    FROM exchange_fetch_log efl
    LEFT JOIN cached_trades ct
      ON ct.telegram_id = efl.telegram_id
     AND ct.exchange    = efl.exchange
     AND ct.deleted_at IS NULL
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
 * Returns all stored trades for a user across all exchanges, with no freshness check.
 * Used when API keys are not available (e.g. admin impersonation).
 */
export async function getAllStoredTrades(telegramId: string): Promise<Trade[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, exchange, ticker, position_size, tp, sl,
           open_time, close_time, pnl, market, side
    FROM cached_trades
    WHERE telegram_id = ${BigInt(telegramId)}
      AND deleted_at IS NULL
    ORDER BY close_time DESC
  ` as Record<string, unknown>[]
  return rows.map(rowToTrade)
}

/**
 * Composite key for a trade row. Trade ids are only unique per exchange
 * (see the cached_trades PK), so anything keyed by id alone must include it.
 */
export function tradeKey(exchange: string, id: string): string {
  return `${exchange}|${id}`
}

/**
 * Returns the soft-deleted trades for a user, newest close first.
 * These are excluded from every other read path, so this is the only way
 * the UI can show them behind the "show deleted" toggle.
 */
export async function getDeletedTrades(telegramId: string): Promise<Trade[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT id, exchange, ticker, position_size, tp, sl,
           open_time, close_time, pnl, market, side
    FROM cached_trades
    WHERE telegram_id = ${BigInt(telegramId)}
      AND deleted_at IS NOT NULL
    ORDER BY close_time DESC
  ` as Record<string, unknown>[]
  return rows.map(rowToTrade)
}

/**
 * Returns the `exchange|id` keys of a user's soft-deleted trades.
 *
 * Needed because the live-fetch path returns trades straight from the exchange
 * adapter without re-reading the DB — without this filter a deleted trade would
 * reappear on the next refresh. Pass `exchange` to narrow to a single exchange.
 */
export async function getDeletedKeys(telegramId: string, exchange?: string): Promise<Set<string>> {
  const sql = getSql()
  const tid = BigInt(telegramId)
  const rows = (exchange
    ? await sql`
        SELECT id, exchange FROM cached_trades
        WHERE telegram_id = ${tid} AND exchange = ${exchange} AND deleted_at IS NOT NULL
      `
    : await sql`
        SELECT id, exchange FROM cached_trades
        WHERE telegram_id = ${tid} AND deleted_at IS NOT NULL
      `) as { id: string; exchange: string }[]
  return new Set(rows.map((r) => tradeKey(r.exchange, r.id)))
}

/** Drops any trade the user has soft-deleted. Pure — exported for testing. */
export function filterDeleted<T extends { id: string; exchange: string }>(
  trades: T[],
  deletedKeys: Set<string>
): T[] {
  if (deletedKeys.size === 0) return trades
  return trades.filter((t) => !deletedKeys.has(tradeKey(t.exchange, t.id)))
}

/**
 * Soft-deletes a single trade. Returns false when no such trade exists for
 * this user (wrong id/exchange, or another user's trade).
 */
export async function softDeleteTrade(
  telegramId: string,
  exchange: string,
  id: string
): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    UPDATE cached_trades
    SET deleted_at = NOW()
    WHERE telegram_id = ${BigInt(telegramId)}
      AND exchange    = ${exchange}
      AND id          = ${id}
    RETURNING id
  ` as { id: string }[]
  return rows.length > 0
}

/** Restores a soft-deleted trade. Returns false when no such trade exists. */
export async function restoreTrade(
  telegramId: string,
  exchange: string,
  id: string
): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`
    UPDATE cached_trades
    SET deleted_at = NULL
    WHERE telegram_id = ${BigInt(telegramId)}
      AND exchange    = ${exchange}
      AND id          = ${id}
    RETURNING id
  ` as { id: string }[]
  return rows.length > 0
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
 * Removes trades that share an id, keeping the last occurrence.
 * The cached_trades PK is (telegram_id, exchange, id): without this dedupe, two
 * fetched trades with the same id would silently collapse into one DB row, so the
 * DB would hold fewer trades than the UI displayed from the raw fetched array.
 */
function dedupeById(trades: Trade[]): Trade[] {
  const byId = new Map<string, Trade>()
  for (const t of trades) byId.set(t.id, t)
  return [...byId.values()]
}

/**
 * Upserts a batch of trades and updates the fetch log timestamp.
 *
 * NOTE: the ON CONFLICT update list below deliberately omits `deleted_at`, so a
 * re-sync refreshes a soft-deleted trade's fields but leaves it deleted. Adding
 * `deleted_at` there (or switching to a whole-row upsert) would resurrect every
 * deleted trade on the next fetch.
 */
export async function upsertTrades(telegramId: string, exchange: string, trades: Trade[]): Promise<void> {
  const sql = getSql()
  const tid = BigInt(telegramId)
  const unique = dedupeById(trades)

  if (unique.length > 0) {
    // Build values for bulk upsert
    for (const t of unique) {
      await sql`
        INSERT INTO cached_trades
          (id, telegram_id, exchange, ticker, position_size, tp, sl, open_time, close_time, pnl, market, side)
        VALUES (
          ${t.id}, ${tid}, ${t.exchange}, ${t.ticker},
          ${t.positionSize}, ${t.tp ?? null}, ${t.sl ?? null},
          ${t.openTime}::timestamptz, ${t.closeTime}::timestamptz,
          ${t.pnl}, ${t.market ?? null}, ${t.side ?? null}
        )
        ON CONFLICT (telegram_id, exchange, id) DO UPDATE SET
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
 * Inserts a batch of imported trades, skipping any that already exist (DO NOTHING).
 * Returns the number of rows actually inserted.
 * Also upserts the exchange_fetch_log so the import is tracked.
 *
 * A soft-deleted trade counts as existing, so re-uploading the same CSV keeps it
 * deleted rather than resurrecting it.
 */
export async function insertTradesSkipExisting(
  telegramId: string,
  exchange: string,
  trades: Trade[]
): Promise<number> {
  const sql = getSql()
  const tid = BigInt(telegramId)
  let saved = 0

  for (const t of dedupeById(trades)) {
    const result = await sql`
      INSERT INTO cached_trades
        (id, telegram_id, exchange, ticker, position_size, tp, sl, open_time, close_time, pnl, market, side)
      VALUES (
        ${t.id}, ${tid}, ${t.exchange}, ${t.ticker},
        ${t.positionSize}, ${t.tp ?? null}, ${t.sl ?? null},
        ${t.openTime}::timestamptz, ${t.closeTime}::timestamptz,
        ${t.pnl}, ${t.market ?? null}, ${t.side ?? null}
      )
      ON CONFLICT (telegram_id, exchange, id) DO NOTHING
    ` as unknown[]
    // postgres.js returns the affected rows count via result.count
    if ((result as unknown as { count: number }).count > 0) saved++
  }

  await sql`
    INSERT INTO exchange_fetch_log (telegram_id, exchange, fetched_at)
    VALUES (${tid}, ${exchange}, NOW())
    ON CONFLICT (telegram_id, exchange) DO UPDATE SET fetched_at = NOW()
  `

  return saved
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
