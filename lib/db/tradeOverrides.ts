import { getSql } from "@/lib/db"
import { tradeKey } from "@/lib/db/trades"
import {
  isBias,
  isStorableNumber,
  mergeOverride,
  NUMBER_FIELDS,
  type OverridePatch,
} from "@/lib/services/overridesService"
import {
  isChoice,
  MULTI_CHOICE_FIELDS,
  parseChoices,
  serializeChoices,
  SINGLE_CHOICE_FIELDS,
} from "@/lib/services/journalFields"
import type { TradeOverride, TradeOverridesMap } from "@/types"

/**
 * Storage for manual TP / SL / Bias. The resolution rules (override wins, bias
 * falls back to `side`) live in lib/services/overridesService.ts so the client
 * can share them; this file only reads and writes rows.
 */

/** The snake_case column names, paired with the camelCase field they carry. */
const NUMBER_COLUMNS = {
  entry: "entry",
  tp1: "tp1",
  tp2: "tp2",
  sl: "sl",
  riskPct: "risk_pct",
  rr: "rr",
} as const

const CHOICE_COLUMNS = {
  strategy: "strategy",
  timeframe: "timeframe",
  killzone: "killzone",
  exitReason: "exit_reason",
  mistake: "mistake",
  emotion: "emotion",
} as const

export type OverrideRow = {
  exchange: string
  trade_id: string
  bias: string | null
  rules_ok: boolean | null
} & Record<
  (typeof NUMBER_COLUMNS)[keyof typeof NUMBER_COLUMNS],
  string | number | null
> &
  Record<(typeof CHOICE_COLUMNS)[keyof typeof CHOICE_COLUMNS], string | null>

/**
 * Folds flat override rows into the map the UI indexes by `exchange|id`.
 *
 * Every value is re-validated on the way out, not just parsed: NUMERIC comes
 * back from the driver as a string, and none of the three multi-valued columns
 * carries a CHECK constraint, so a value written outside the app must not reach
 * the UI as if it were a real option.
 *
 * The multi-valued columns hold a '|'-joined list. A row written before those
 * fields went multi-select holds a bare slug, which parses as the one-tag list
 * it always was — no backfill, and an old row and a new one read the same.
 *
 * Pure — exported for testing.
 */
export function rowsToOverridesMap(rows: OverrideRow[]): TradeOverridesMap {
  const map: TradeOverridesMap = {}
  for (const r of rows) {
    const override: TradeOverride = {}

    for (const field of NUMBER_FIELDS) {
      const raw = r[NUMBER_COLUMNS[field]]
      if (raw === null || raw === undefined) continue
      const n = Number(raw)
      if (isStorableNumber(field, n)) override[field] = n
    }

    for (const field of SINGLE_CHOICE_FIELDS) {
      const raw = r[CHOICE_COLUMNS[field]]
      if (isChoice(field, raw)) override[field] = raw as string
    }

    for (const field of MULTI_CHOICE_FIELDS) {
      const values = parseChoices(field, r[CHOICE_COLUMNS[field]])
      // An empty list is left off entirely, so `field in override` keeps meaning
      // "the user set this" for a multi-valued field as much as a single one.
      if (values.length > 0) override[field] = values
    }

    if (isBias(r.bias)) override.bias = r.bias
    if (typeof r.rules_ok === "boolean") override.rulesOK = r.rules_ok

    // A row that survived the table's CHECK but carries nothing usable is
    // dropped rather than surfaced as an empty journal entry.
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
    SELECT exchange, trade_id, bias, entry, tp1, tp2, sl, risk_pct, rr, rules_ok,
           strategy, timeframe, killzone, exit_reason, mistake, emotion
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
    SELECT exchange, trade_id, bias, entry, tp1, tp2, sl, risk_pct, rr, rules_ok,
           strategy, timeframe, killzone, exit_reason, mistake, emotion
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

  // The whole row is written every time — `next` is the merged result, so a
  // field the patch did not mention is re-written with the value it already had.
  // The three multi-valued fields collapse to a '|'-joined string here, and to
  // NULL when nothing is selected, which is what keeps the table's empty_chk
  // reading them as unset.
  await sql`
    INSERT INTO trade_overrides (
      telegram_id, exchange, trade_id,
      bias, entry, tp1, tp2, sl, risk_pct, rr, rules_ok,
      strategy, timeframe, killzone, exit_reason, mistake, emotion
    )
    VALUES (
      ${tid}, ${exchange}, ${tradeId},
      ${next.bias ?? null}, ${next.entry ?? null}, ${next.tp1 ?? null},
      ${next.tp2 ?? null}, ${next.sl ?? null}, ${next.riskPct ?? null},
      ${next.rr ?? null}, ${next.rulesOK ?? null},
      ${next.strategy ?? null}, ${next.timeframe ?? null}, ${next.killzone ?? null},
      ${serializeChoices(next.exitReason ?? [])},
      ${serializeChoices(next.mistake ?? [])},
      ${serializeChoices(next.emotion ?? [])}
    )
    ON CONFLICT (telegram_id, exchange, trade_id) DO UPDATE SET
      bias        = EXCLUDED.bias,
      entry       = EXCLUDED.entry,
      tp1         = EXCLUDED.tp1,
      tp2         = EXCLUDED.tp2,
      sl          = EXCLUDED.sl,
      risk_pct    = EXCLUDED.risk_pct,
      rr          = EXCLUDED.rr,
      rules_ok    = EXCLUDED.rules_ok,
      strategy    = EXCLUDED.strategy,
      timeframe   = EXCLUDED.timeframe,
      killzone    = EXCLUDED.killzone,
      exit_reason = EXCLUDED.exit_reason,
      mistake     = EXCLUDED.mistake,
      emotion     = EXCLUDED.emotion,
      updated_at  = NOW()
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
