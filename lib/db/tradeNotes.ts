import { getSql } from "@/lib/db"
import { tradeKey } from "@/lib/db/trades"
import type { TradeNotePhase, TradeNotes, TradeNotesMap } from "@/types"

export const NOTE_PHASES: TradeNotePhase[] = ["before", "during", "after"]

/** Longest note we store. Generous for a journal entry, bounded for the DB. */
export const MAX_NOTE_LENGTH = 4000

export function isNotePhase(value: unknown): value is TradeNotePhase {
  return typeof value === "string" && (NOTE_PHASES as string[]).includes(value)
}

/**
 * Folds flat note rows into the map the UI indexes by `exchange|id`.
 * Pure — exported for testing.
 */
export function rowsToNotesMap(
  rows: { exchange: string; trade_id: string; phase: string; body: string }[]
): TradeNotesMap {
  const map: TradeNotesMap = {}
  for (const r of rows) {
    if (!isNotePhase(r.phase)) continue
    const key = tradeKey(r.exchange, r.trade_id)
    const notes: TradeNotes = map[key] ?? (map[key] = {})
    notes[r.phase] = r.body
  }
  return map
}

/**
 * Every note belonging to a user, in one query. The dashboard loads these once
 * on mount and joins them to the trades client-side, so there is no per-trade
 * round trip and no join against cached_trades (whose rows may not exist yet
 * for client-fetched exchanges).
 */
export async function getNotes(telegramId: string): Promise<TradeNotesMap> {
  const sql = getSql()
  const rows = (await sql`
    SELECT exchange, trade_id, phase, body
    FROM trade_notes
    WHERE telegram_id = ${BigInt(telegramId)}
  `) as { exchange: string; trade_id: string; phase: string; body: string }[]
  return rowsToNotesMap(rows)
}

/**
 * Writes one note. A blank body deletes the row instead of storing it, so
 * clearing the textarea and saving is how a user removes a note — the table's
 * CHECK constraint rejects empty bodies outright.
 *
 * Returns the stored body, or null when the note was cleared.
 *
 * The user row is upserted first for the same reason as insertEntry in
 * lib/db/spot.ts: telegramId comes from the client and the user may not exist
 * yet on their first ever action.
 */
export async function saveNote(
  telegramId: string,
  exchange: string,
  tradeId: string,
  phase: TradeNotePhase,
  body: string
): Promise<string | null> {
  const sql = getSql()
  const tid = BigInt(telegramId)
  const trimmed = body.trim().slice(0, MAX_NOTE_LENGTH)

  if (trimmed === "") {
    await sql`
      DELETE FROM trade_notes
      WHERE telegram_id = ${tid}
        AND exchange    = ${exchange}
        AND trade_id    = ${tradeId}
        AND phase       = ${phase}
    `
    return null
  }

  await sql`
    INSERT INTO users (telegram_id, telegram_name)
    VALUES (${tid}, ${"unknown"})
    ON CONFLICT (telegram_id) DO NOTHING
  `

  const rows = (await sql`
    INSERT INTO trade_notes (telegram_id, exchange, trade_id, phase, body)
    VALUES (${tid}, ${exchange}, ${tradeId}, ${phase}, ${trimmed})
    ON CONFLICT (telegram_id, exchange, trade_id, phase) DO UPDATE SET
      body       = EXCLUDED.body,
      updated_at = NOW()
    RETURNING body
  `) as { body: string }[]

  return rows[0]?.body ?? trimmed
}

/**
 * Drops every note attached to a trade. Not wired to soft delete on purpose —
 * a soft-deleted trade can be restored, and losing the journal with it would
 * make the delete effectively irreversible.
 */
export async function deleteNotesForTrade(
  telegramId: string,
  exchange: string,
  tradeId: string
): Promise<void> {
  const sql = getSql()
  await sql`
    DELETE FROM trade_notes
    WHERE telegram_id = ${BigInt(telegramId)}
      AND exchange    = ${exchange}
      AND trade_id    = ${tradeId}
  `
}
