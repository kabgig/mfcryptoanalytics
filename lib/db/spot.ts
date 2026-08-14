import { getSql } from "@/lib/db"
import type { SpotEntry } from "@/types/spot"

function rowToEntry(r: Record<string, unknown>): SpotEntry {
  return {
    id: String(r.id),
    ticker: r.ticker as string,
    side: r.side as SpotEntry["side"],
    qty: Number(r.qty),
    price: Number(r.price),
    tradedAt: (r.traded_at as Date).toISOString(),
  }
}

/** A user's live entries, oldest first — the order the DCA replay needs. */
export async function getEntries(telegramId: string): Promise<SpotEntry[]> {
  const sql = getSql()
  const rows = (await sql`
    SELECT id, ticker, side, qty, price, traded_at
    FROM spot_entries
    WHERE telegram_id = ${BigInt(telegramId)}
      AND deleted_at IS NULL
    ORDER BY traded_at ASC, id ASC
  `) as Record<string, unknown>[]
  return rows.map(rowToEntry)
}

/**
 * Inserts one entry. The user row is upserted first because spot_entries has a
 * FK to users, and the same telegram-id-from-the-client pattern as the other
 * routes means the user may not exist yet on their first ever action.
 */
export async function insertEntry(
  telegramId: string,
  entry: { ticker: string; side: "BUY" | "SELL"; qty: number; price: number; tradedAt: string }
): Promise<SpotEntry> {
  const sql = getSql()
  await sql`
    INSERT INTO users (telegram_id, telegram_name)
    VALUES (${BigInt(telegramId)}, ${"unknown"})
    ON CONFLICT (telegram_id) DO NOTHING
  `
  const rows = (await sql`
    INSERT INTO spot_entries (telegram_id, ticker, side, qty, price, traded_at)
    VALUES (${BigInt(telegramId)}, ${entry.ticker}, ${entry.side},
            ${entry.qty}, ${entry.price}, ${entry.tradedAt})
    RETURNING id, ticker, side, qty, price, traded_at
  `) as Record<string, unknown>[]
  return rowToEntry(rows[0])
}

/**
 * Soft-deletes one entry. Returns false when the id does not belong to this
 * user, which is what stops one user deleting another's row.
 */
export async function softDeleteEntry(telegramId: string, id: string): Promise<boolean> {
  const sql = getSql()
  const rows = (await sql`
    UPDATE spot_entries
    SET deleted_at = NOW()
    WHERE telegram_id = ${BigInt(telegramId)}
      AND id = ${BigInt(id)}
      AND deleted_at IS NULL
    RETURNING id
  `) as { id: string }[]
  return rows.length > 0
}

/** Cached daily closes for the given tickers from `since` onward, oldest first. */
export async function getPriceHistory(
  tickers: string[],
  since: string
): Promise<Record<string, { day: string; close: number }[]>> {
  if (tickers.length === 0) return {}
  const sql = getSql()
  const rows = (await sql`
    SELECT ticker, day, close
    FROM spot_price_history
    WHERE ticker = ANY(${tickers})
      AND day >= ${since}
    ORDER BY ticker, day ASC
  `) as { ticker: string; day: Date; close: number }[]

  const out: Record<string, { day: string; close: number }[]> = {}
  for (const r of rows) {
    const day = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day)
    ;(out[r.ticker] ??= []).push({ day, close: Number(r.close) })
  }
  return out
}

/**
 * Oldest and newest cached day per ticker. The backfill uses these to fetch
 * only what is missing — re-writing whole histories on every page load would
 * churn WAL and bloat the table, which is the real risk on Neon's free tier.
 *
 * Both ends matter. Resuming only forward from MAX(day) looks correct until an
 * entry is backdated: the cache already reaches today, so nothing is fetched
 * and the chart silently has no market line before the cached window. Callers
 * compare against MIN(day) too and fill the older gap.
 */
export async function getCachedDayRange(
  tickers: string[]
): Promise<Record<string, { min: string; max: string }>> {
  if (tickers.length === 0) return {}
  const sql = getSql()
  const rows = (await sql`
    SELECT ticker, MIN(day) AS min_day, MAX(day) AS max_day
    FROM spot_price_history
    WHERE ticker = ANY(${tickers})
    GROUP BY ticker
  `) as { ticker: string; min_day: Date | string; max_day: Date | string }[]

  const day = (v: Date | string) =>
    v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)

  const out: Record<string, { min: string; max: string }> = {}
  for (const r of rows) out[r.ticker] = { min: day(r.min_day), max: day(r.max_day) }
  return out
}

/**
 * Appends daily closes, ignoring days already cached. ON CONFLICT DO NOTHING
 * (rather than DO UPDATE) keeps this append-only: a re-run writes zero rows and
 * creates no dead tuples.
 */
export async function insertPricesSkipExisting(
  ticker: string,
  points: { day: string; close: number }[]
): Promise<number> {
  if (points.length === 0) return 0
  const sql = getSql()
  const days = points.map((p) => p.day)
  const closes = points.map((p) => p.close)
  const rows = (await sql`
    INSERT INTO spot_price_history (ticker, day, close)
    SELECT ${ticker}, d::date, c
    FROM unnest(${days}::text[], ${closes}::float8[]) AS t(d, c)
    ON CONFLICT (ticker, day) DO NOTHING
    RETURNING day
  `) as unknown[]
  return rows.length
}
