import { tradeKey } from "@/lib/db/trades"
import {
  CHOICE_FIELDS,
  computeRr,
  isChoice,
  MULTI_CHOICE_FIELDS,
  normalizeChoices,
  SINGLE_CHOICE_FIELDS,
} from "@/lib/services/journalFields"
import type {
  Trade,
  TradeBias,
  TradeJournalChoice,
  TradeOverride,
  TradeOverridesMap,
} from "@/types"

/**
 * The user's hand-written record of a trade, resolved against what the exchange
 * reported.
 *
 * Kept free of any DB import so client components can use it: the rules below
 * are shared by the table, the journal form, the CSV export, the LvsS split and
 * the API route, and re-deriving them in each place is how "the user's value
 * wins" quietly stops being true somewhere.
 */

/** Numeric journal fields that hold a price. */
export const PRICE_FIELDS = ["entry", "tp1", "tp2", "sl"] as const
export type PriceField = (typeof PRICE_FIELDS)[number]

/** Every numeric field, with the range a NUMERIC column is allowed to take. */
export const NUMBER_LIMITS = {
  entry: { min: 0, max: Infinity },
  tp1: { min: 0, max: Infinity },
  tp2: { min: 0, max: Infinity },
  sl: { min: 0, max: Infinity },
  // A percentage of the deposit; 100 is the whole account.
  riskPct: { min: 0, max: 100 },
  // Reward-to-risk. Capped well above anything real to keep a typo out of the DB.
  rr: { min: 0, max: 1000 },
} as const

export type NumberField = keyof typeof NUMBER_LIMITS
export const NUMBER_FIELDS = Object.keys(NUMBER_LIMITS) as NumberField[]

/** Every field the user can set, in the order the form shows them. */
export const OVERRIDE_FIELDS = [
  "bias",
  "strategy",
  "timeframe",
  "killzone",
  "entry",
  "tp1",
  "tp2",
  "sl",
  "riskPct",
  "rr",
  "rulesOK",
  "exitReason",
  "mistake",
  "emotion",
] as const
export type OverrideField = (typeof OVERRIDE_FIELDS)[number]

export function isBias(value: unknown): value is TradeBias {
  return value === "buy" || value === "sell"
}

/**
 * A number is only storable if it is finite and inside its field's range.
 * Rejecting NaN/Infinity here keeps them out of a NUMERIC column, where they
 * would either error or come back as something the UI cannot format.
 */
export function isStorableNumber(field: NumberField, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false
  const { min, max } = NUMBER_LIMITS[field]
  return value >= min && value <= max
}

/**
 * The bias implied by the exchange's own `side`. Only Bybit and Bitunix report
 * one, so this is null for most trades and the user supplies it by hand.
 */
export function sideToBias(side: Trade["side"]): TradeBias | null {
  if (side === "long") return "buy"
  if (side === "short") return "sell"
  return null
}

/**
 * A trade with its journal entry applied. The resolved values sit alongside the
 * raw trade rather than replacing `Trade`, so every path that writes a trade
 * back to cached_trades stays exactly as it was.
 */
export interface ResolvedTrade extends Trade {
  bias: TradeBias | null
  /** Effective first take-profit: the user's, else whatever the exchange sent. */
  tp1: number | null
  /** Second take-profit — a journal-only concept, no exchange reports one. */
  tp2: number | null
  /** Effective stop loss. Shadows `Trade.sl`, same meaning, resolved. */
  sl: number | null
  /** The user's own R:R when set, otherwise the one implied by entry/tp1/sl. */
  rr: number | null
  /** The raw journal entry — `{}` when the user has recorded nothing. */
  journal: TradeOverride
  /** Which fields the user set by hand, so the UI can mark them. */
  overridden: Record<OverrideField, boolean>
}

/**
 * Applies one trade's journal entry. A value the user set always wins over the
 * exchange's, including when the exchange did report one — no adapter populates
 * tp or sl today, but if one starts, a user's correction still stands.
 */
export function resolveTrade(trade: Trade, override?: TradeOverride): ResolvedTrade {
  const o = override ?? {}
  const hasBias = isBias(o.bias)

  const tp1 = o.tp1 ?? trade.tp
  const sl = o.sl ?? trade.sl

  const overridden = Object.fromEntries(
    OVERRIDE_FIELDS.map((f) => [f, o[f] !== undefined])
  ) as Record<OverrideField, boolean>
  // A bias outside buy/sell is not an override, however it got into the row.
  overridden.bias = hasBias

  return {
    ...trade,
    bias: hasBias ? o.bias! : sideToBias(trade.side),
    tp1,
    tp2: o.tp2 ?? null,
    sl,
    // Computed unless the user typed their own — the form shows the arithmetic
    // and lets them replace it.
    rr: o.rr ?? computeRr(o.entry ?? null, tp1, sl),
    journal: o,
    overridden,
  }
}

/** Resolves a whole list against the journal map the dashboard holds. */
export function resolveTrades(
  trades: Trade[],
  overrides: TradeOverridesMap = {}
): ResolvedTrade[] {
  return trades.map((t) => resolveTrade(t, overrides[tradeKey(t.exchange, t.id)]))
}

/**
 * Merges a patch onto a stored journal entry. A key set to null clears that
 * field (falling back to the exchange value, or to the computed R:R); a key left
 * out is untouched — so the Bias cell can save one field without having to send
 * the other thirteen.
 *
 * For a multi-valued field an empty array clears it exactly as null does: an
 * unticked list and a never-touched one are the same answer, and letting `[]`
 * through would store a field the table's CHECK counts as content while the UI
 * renders it as blank.
 *
 * Returns null when nothing is left set, which is the signal to delete the row
 * rather than store an empty one.
 */
export type OverridePatch = Partial<{
  [K in keyof TradeOverride]: TradeOverride[K] | null
}>

export function mergeOverride(
  current: TradeOverride,
  patch: OverridePatch
): TradeOverride | null {
  const next: TradeOverride = { ...current }

  for (const field of NUMBER_FIELDS) {
    if (!(field in patch)) continue
    const value = patch[field]
    if (isStorableNumber(field, value)) next[field] = value
    else delete next[field]
  }

  for (const field of SINGLE_CHOICE_FIELDS) {
    if (!(field in patch)) continue
    const value = patch[field]
    if (isChoice(field, value)) next[field] = value as string
    else delete next[field]
  }

  for (const field of MULTI_CHOICE_FIELDS) {
    if (!(field in patch)) continue
    // Anything unrecognised is dropped rather than stored, the same way a bad
    // single choice is — and a selection left with nothing in it clears.
    const values = normalizeChoices(field, patch[field])
    if (values.length > 0) next[field] = values
    else delete next[field]
  }

  if ("bias" in patch) {
    if (isBias(patch.bias)) next.bias = patch.bias
    else delete next.bias
  }

  if ("rulesOK" in patch) {
    if (typeof patch.rulesOK === "boolean") next.rulesOK = patch.rulesOK
    else delete next.rulesOK
  }

  return OVERRIDE_FIELDS.every((f) => next[f] === undefined) ? null : next
}

export { CHOICE_FIELDS, computeRr, isChoice, MULTI_CHOICE_FIELDS, SINGLE_CHOICE_FIELDS }
export type { TradeJournalChoice }
