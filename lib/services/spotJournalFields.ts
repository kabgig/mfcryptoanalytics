import type { SpotJournal } from "@/types/spot"

/**
 * The spot journal's vocabularies and the rules for reading and writing it.
 *
 * One module so the popup, the API validator, the database layer and the CSV
 * export can never disagree about what a tag means. Adding a value here is all
 * it takes — the database stores the tags as text with no CHECK on them.
 *
 * `why` and `feeling` both take several tags: a dip buy can be a DCA buy too,
 * and a sell can be calm and a little unsure at the same time.
 */

export const SPOT_WHY = ["dca", "dip", "news", "pump", "take_profit"] as const
export const SPOT_FEELINGS = ["calm", "unsure", "thrill", "fomo"] as const

export type SpotWhy = (typeof SPOT_WHY)[number]
export type SpotFeeling = (typeof SPOT_FEELINGS)[number]

/** Same cap as the futures notes (components/dashboard/TradeJournal.tsx). */
export const MAX_SPOT_NOTE_LENGTH = 4000

/**
 * What separates tags inside their text column and the CSV cell. A pipe, as in
 * the futures journal, so the export never has to quote a tag list.
 */
export const SPOT_TAG_DELIMITER = "|"

export const EMPTY_SPOT_JOURNAL: SpotJournal = Object.freeze({
  planned: null,
  why: [],
  feeling: [],
  note: "",
}) as SpotJournal

const VOCABULARY = { why: SPOT_WHY, feeling: SPOT_FEELINGS } as const
type TagField = keyof typeof VOCABULARY

const LABELS: Record<string, string> = {
  dca: "DCA",
  take_profit: "Take profit",
  fomo: "FOMO",
}

/** Human wording for a tag; anything not listed is title-cased from the slug. */
export function spotTagLabel(tag: string): string {
  return LABELS[tag] ?? tag.charAt(0).toUpperCase() + tag.slice(1)
}

/**
 * Known tags only, de-duplicated, in vocabulary order — so the same selection
 * always serializes to the same string whatever order it was clicked in.
 */
export function normalizeSpotTags(field: TagField, values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const vocabulary = VOCABULARY[field] as readonly string[]
  const kept = new Set(values.filter((v) => typeof v === "string"))
  return vocabulary.filter((tag) => kept.has(tag))
}

/** A tag list as stored in its column, or null when empty. */
export function serializeSpotTags(values: readonly string[]): string | null {
  return values.length === 0 ? null : values.join(SPOT_TAG_DELIMITER)
}

/** A stored column back into tags. Tolerant: unknown tags are dropped, not thrown. */
export function parseSpotTags(field: TagField, raw: unknown): string[] {
  if (typeof raw !== "string" || raw === "") return []
  return normalizeSpotTags(field, raw.split(SPOT_TAG_DELIMITER))
}

/** A database row's journal columns as a journal. */
export function journalFromRow(r: Record<string, unknown>): SpotJournal {
  return {
    planned: typeof r.planned === "boolean" ? r.planned : null,
    why: parseSpotTags("why", r.why),
    feeling: parseSpotTags("feeling", r.feeling),
    note: typeof r.note === "string" ? r.note : "",
  }
}

/** Whether anything has been written — what lights up the row's journal icon. */
export function hasSpotJournal(j: SpotJournal | undefined): boolean {
  if (!j) return false
  return j.planned !== null || j.why.length > 0 || j.feeling.length > 0 || j.note.trim() !== ""
}

/**
 * Validates a journal sent to the API. Strict, because it guards the boundary:
 * an unknown tag or a wrong type is a bug in the caller and comes back as an
 * error string rather than being quietly narrowed. Every field must be present —
 * the popup always saves the whole journal, and a missing key being read as
 * "clear it" is exactly the ambiguity that requiring it avoids.
 *
 * Empty lists and a blank note are how a field is cleared. The note keeps its
 * inner line breaks; only surrounding whitespace is trimmed.
 */
export function parseSpotJournalBody(body: Record<string, unknown>): SpotJournal | string {
  const { planned, note } = body

  if (planned !== null && typeof planned !== "boolean") {
    return "planned must be true, false or null"
  }

  const tags: Record<TagField, string[]> = { why: [], feeling: [] }
  for (const field of ["why", "feeling"] as const) {
    const value = body[field]
    const vocabulary = VOCABULARY[field] as readonly string[]
    if (!Array.isArray(value)) return `${field} must be a list`
    if (value.length > vocabulary.length) return `${field} has too many tags`
    if (new Set(value).size !== value.length) return `${field} repeats a tag`
    if (!value.every((v) => typeof v === "string" && vocabulary.includes(v))) {
      return `${field} has an unknown tag`
    }
    tags[field] = normalizeSpotTags(field, value)
  }

  if (typeof note !== "string") return "note must be a string"
  if (note.length > MAX_SPOT_NOTE_LENGTH) {
    return `note must be at most ${MAX_SPOT_NOTE_LENGTH} characters`
  }

  return { planned, why: tags.why, feeling: tags.feeling, note: note.trim() }
}
