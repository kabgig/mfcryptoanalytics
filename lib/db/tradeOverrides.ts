import { getSql } from "@/lib/db"
import { tradeKey } from "@/lib/db/trades"
import { isBias, mergeOverride, type OverridePatch } from "@/lib/services/overridesService"
import type { TradeOverride, TradeOverridesMap } from "@/types"

/**
 * Storage for manual TP / SL / Bias. The resolution rules (override wins, bias
 * falls back to `side`) live in lib/services/overridesService.ts so the client
 * can share them; this file only reads and writes rows.
 */

type OverrideRow = {
  exchange: string
  trade_id: string
  tp: string | number | null
  sl: string | number | null
  bias: string | null
}

/** NUMERIC comes back from the driver as a string — never hand it to the UI raw. */
function toPrice(value: string | number | null): number | undefined {
  if (value === null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Folds flat override rows into the map the UI indexes by `exchange|id`.
 * Pure — exported for testing.
 */
export function rowsToOverridesMap(rows: OverrideRow[]): TradeOverridesMap {
  const map: TradeOverridesMap = {}
  for (const r of rows) {
    const override: TradeOverride = {}
    const tp = toPrice(r.tp)
    const sl = toPrice(r.sl)
    if (tp !== undefined) override.tp = tp
    if (sl !== undefined) override.sl = sl
    if (isBias(r.bias)) override.bias = r.bias
    // A row that survived the table's CHECK but carries nothing usable (e.g. a
    // bias written by hand outside the app) is dropped rather than surfaced as
    // an empty override.
    if (Object.keys(override).length > 0) map[tradeKey(r.exchange, r.trade_id)] = override
  }
  return map
}

/**
 * Every override belonging to a user, in one query. Loaded once on dashboard
 * mount and joined to the trades client-side — same shape as getNotes, and for
 * the same reason: no per-trade round trip, and no join against cached_trades,
 * whose rows may not exist yet for client-fetched exchanges.
 */
export async function getOverrides(telegramId: string): Promise<TradeOverridesMap> {
  const sql = getSql()
  const rows = (await sql`
    SELECT exchange, trade_id, tp, sl, bias
    FROM trade_overrides
    WHERE telegram_id = ${BigInt(telegramId)}
  `) as OverrideRow[]
  return rowsToOverridesMap(rows)
}

/** One trade's stored override, or {} when it has none. */
async function getOverride(
  telegramId: string,
  exchange: string,
  tradeId: string
): Promise<TradeOverride> {
  const sql = getSql()
  const rows = (await sql`
    SELECT exchange, trade_id, tp, sl, bias
    FROM trade_overrides
    WHERE telegram_id = ${BigInt(telegramId)}
      AND exchange    = ${exchange}
      AND trade_id    = ${tradeId}
  `) as OverrideRow[]
  return rowsToOverridesMap(rows)[tradeKey(exchange, tradeId)] ?? {}
}

/**
 * Applies a patch to one trade's override and returns what is now stored, or
 * null when the last override was cleared and the row was deleted.
 *
 * Read-modify-write rather than a clever ON CONFLICT expression: a patch may
 * touch one field and must leave the others alone, and clearing the final field
 * has to delete the row instead of writing one the table's CHECK would reject.
 * Only the owning user ever edits a given row, so there is nothing to race.
 *
 * The user row is upserted first for the same reason as saveNote: telegramId
 * comes from the client and the user may not exist yet on their first action.
 */
export async function saveOverride(
  telegramId: string,
  exchange: string,
  tradeId: string,
  patch: OverridePatch
): Promise<TradeOverride | null> {
  const sql = getSql()
  const tid = BigInt(telegramId)
  const next = mergeOverride(await getOverride(telegramId, exchange, tradeId), patch)

  if (next === null) {
    await sql`
      DELETE FROM trade_overrides
      WHERE telegram_id = ${tid}
        AND exchange    = ${exchange}
        AND trade_id    = ${tradeId}
    `
    return null
  }

  await sql`
    INSERT INTO users (telegram_id, telegram_name)
    VALUES (${tid}, ${"unknown"})
    ON CONFLICT (telegram_id) DO NOTHING
  `

  await sql`
    INSERT INTO trade_overrides (telegram_id, exchange, trade_id, tp, sl, bias)
    VALUES (${tid}, ${exchange}, ${tradeId},
            ${next.tp ?? null}, ${next.sl ?? null}, ${next.bias ?? null})
    ON CONFLICT (telegram_id, exchange, trade_id) DO UPDATE SET
      tp         = EXCLUDED.tp,
      sl         = EXCLUDED.sl,
      bias       = EXCLUDED.bias,
      updated_at = NOW()
  `

  return next
}

/**
 * Drops every override attached to a trade. Not wired to soft delete, for the
 * same reason as deleteNotesForTrade: a deleted trade can be restored, and
 * losing the user's own numbers with it would make the delete irreversible.
 */
export async function deleteOverridesForTrade(
  telegramId: string,
  exchange: string,
  tradeId: string
): Promise<void> {
  const sql = getSql()
  await sql`
    DELETE FROM trade_overrides
    WHERE telegram_id = ${BigInt(telegramId)}
      AND exchange    = ${exchange}
      AND trade_id    = ${tradeId}
  `
}
