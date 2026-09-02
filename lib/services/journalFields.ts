import type {
  TradeJournalChoice,
  TradeJournalMultiChoice,
  TradeJournalSingleChoice,
} from "@/types"

/**
 * The controlled vocabularies behind the trade journal form.
 *
 * One module so the inputs, the API validator and the CSV export can never
 * disagree about what a tag means. Adding a value here is all it takes for the
 * three of them to accept it — only `strategy`, `timeframe` and `killzone` are
 * additionally pinned by a CHECK constraint in the database, so extending
 * *those* three needs a migration as well.
 *
 * Two kinds of field live here. `strategy`, `timeframe` and `killzone` take one
 * answer: a trade has a single setup, on a single timeframe, in a single
 * session. `exitReason`, `mistake` and `emotion` take several — a position can
 * scale out at TP1 and get stopped out of the runner, and a trade that went
 * wrong rarely went wrong in exactly one way. Holding those three to one answer
 * was making the user pick a headline and lose the rest of the review.
 */

export const STRATEGIES = ["orderflow", "pa", "macro"] as const
export const TIMEFRAMES = ["5m", "15m", "1h"] as const
export const KILLZONES = ["asia", "london", "nyam", "nypm", "outside"] as const
export const EXIT_REASONS = ["tp1", "tp2", "sl", "be", "manual"] as const

/**
 * No `none` tag any more: with several mistakes selectable at once, an empty
 * list already reads as "nothing went wrong", and a "No mistake" checkbox
 * sitting alongside fifteen real ones only invites contradicting itself. The
 * distinction that tag used to carry — "reviewed, clean" against "not reviewed
 * yet" — belongs to `rulesOK`, which stores `false` and unset as different
 * things already.
 */
export const MISTAKES = [
  "no_stop",
  "added_to_loser",
  "mixed_strategies",
  "rushed_no_setup",
  "no_displacement",
  "no_move_to_be",
  "moved_sl_away_from_be",
  "no_partial_at_50",
  "chased_price",
  "over_2_losses_today",
  "decided_while_tired",
  "entry_outside_killzone",
  "entered_against_liquidity",
  "rr_below_1_8",
  "traded_the_news",
] as const

export const EMOTIONS = [
  "calm",
  "confident",
  "unsure",
  "fear",
  "boredom",
  "thrill",
  "greed",
  "anger",
] as const

export type Strategy = (typeof STRATEGIES)[number]
export type Timeframe = (typeof TIMEFRAMES)[number]
export type Killzone = (typeof KILLZONES)[number]
export type ExitReason = (typeof EXIT_REASONS)[number]
export type Mistake = (typeof MISTAKES)[number]
export type Emotion = (typeof EMOTIONS)[number]

/** Every choice field, with the values it accepts. Drives validation and the form. */
export const CHOICES = {
  strategy: STRATEGIES,
  timeframe: TIMEFRAMES,
  killzone: KILLZONES,
  exitReason: EXIT_REASONS,
  mistake: MISTAKES,
  emotion: EMOTIONS,
} as const satisfies Record<TradeJournalChoice, readonly string[]>

export const CHOICE_FIELDS = Object.keys(CHOICES) as TradeJournalChoice[]

/** The choice fields that hold exactly one value. */
export const SINGLE_CHOICE_FIELDS = [
  "strategy",
  "timeframe",
  "killzone",
] as const satisfies readonly TradeJournalSingleChoice[]

/** The choice fields that hold a list — none, one, or several tags. */
export const MULTI_CHOICE_FIELDS = [
  "exitReason",
  "mistake",
  "emotion",
] as const satisfies readonly TradeJournalMultiChoice[]

export function isMultiChoiceField(field: TradeJournalChoice): field is TradeJournalMultiChoice {
  return (MULTI_CHOICE_FIELDS as readonly string[]).includes(field)
}

/**
 * What separates the tags of a multi-select field inside its single text column.
 *
 * A pipe rather than a comma because the CSV export is the surface these fields
 * exist for: a comma would force the writer to quote the cell, and the export is
 * meant to paste into a spreadsheet — or an LLM — without anything having to
 * unpick quoting first. No slug in any vocabulary may contain it, which
 * scripts/test/journalFields.test.ts holds to.
 */
export const CHOICE_DELIMITER = "|"

/** Whether `value` is an accepted option for `field`. */
export function isChoice(field: TradeJournalChoice, value: unknown): boolean {
  return typeof value === "string" && (CHOICES[field] as readonly string[]).includes(value)
}

/**
 * Whether `value` is a usable selection for a multi-select field: a non-empty
 * array of that field's own options, with nothing repeated.
 *
 * Strict, because it guards the API boundary — a request naming a tag that does
 * not exist is a bug in the caller and comes back as a 400 rather than being
 * quietly narrowed to the tags that did parse. Storage-side code uses
 * `normalizeChoices` instead, which drops what it cannot use.
 */
export function isChoiceList(field: TradeJournalChoice, value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0) return false
  if (new Set(value).size !== value.length) return false
  return value.every((v) => isChoice(field, v))
}

/**
 * The storable form of a selection: known options only, de-duplicated, and put
 * back into the order the vocabulary lists them.
 *
 * Canonical order rather than click order, so the same set of tags always
 * serializes to the same string. That is what keeps a CSV diff meaningful and
 * stops a re-save that changed nothing from looking like an edit.
 *
 * Returns an empty array when nothing survives, which every caller reads as
 * "this field is unset" — the same signal an empty single-choice field gives.
 */
export function normalizeChoices(field: TradeJournalChoice, values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const vocabulary = CHOICES[field] as readonly string[]
  const kept = new Set(values.filter((v) => isChoice(field, v)) as string[])
  return vocabulary.filter((option) => kept.has(option))
}

/** A selection as it is stored in its text column, or null when it is empty. */
export function serializeChoices(values: readonly string[]): string | null {
  return values.length === 0 ? null : values.join(CHOICE_DELIMITER)
}

/**
 * A stored text column back into a selection. Tolerant by design: this reads
 * what is already in the database, including a row written before the field went
 * multi-select (a bare "tp1" is a one-tag list) and one written outside the app.
 */
export function parseChoices(field: TradeJournalChoice, raw: unknown): string[] {
  if (typeof raw !== "string" || raw === "") return []
  return normalizeChoices(field, raw.split(CHOICE_DELIMITER))
}

/** The tags of a selection, joined for a human to read. */
export function choiceListLabel(values: readonly string[]): string {
  return values.map(choiceLabel).join(", ")
}

/**
 * Human wording for the dropdowns. Only entries whose slug does not read well
 * on its own are listed; anything missing is title-cased from the slug.
 */
const LABELS: Record<string, string> = {
  pa: "Price action",
  nyam: "NY AM",
  nypm: "NY PM",
  be: "Break-even",
  manual: "Closed by hand",
  tp1: "TP1",
  tp2: "TP2",
  sl: "SL",
  no_stop: "No stop loss",
  added_to_loser: "Added to a loser",
  mixed_strategies: "Mixed strategies",
  rushed_no_setup: "Rushed, did not wait for the setup",
  no_displacement: "Did not wait for displacement",
  no_move_to_be: "Did not move to break-even",
  moved_sl_away_from_be: "Moved SL away from break-even",
  no_partial_at_50: "Did not take 50% off",
  chased_price: "Chased price",
  over_2_losses_today: "More than 2 losses that day",
  decided_while_tired: "Took a decision while tired",
  entry_outside_killzone: "Entered outside the killzone",
  entered_against_liquidity: "Entered against thick liquidity on the other side",
  rr_below_1_8: "R:R below 1.8",
  traded_the_news: "Traded the news",
}

export function choiceLabel(value: string): string {
  return LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Reward-to-risk from the planned levels: how far TP1 sits from the entry,
 * against how far the stop does.
 *
 * Direction-agnostic on purpose — it reads the same for a long planned above the
 * entry and a short planned below it, so the user does not have to have set a
 * bias before the number means anything. Returns null when a level is missing or
 * the stop sits exactly on the entry (no risk to divide by).
 */
export function computeRr(
  entry: number | null | undefined,
  tp1: number | null | undefined,
  sl: number | null | undefined
): number | null {
  if (entry == null || tp1 == null || sl == null) return null
  const risk = Math.abs(entry - sl)
  if (risk === 0) return null
  const reward = Math.abs(tp1 - entry)
  // Two decimals: the thing users compare it against ("R:R below 1.8") is
  // written to one, and a raw float would render as 1.7999999999999998.
  return Math.round((reward / risk) * 100) / 100
}
