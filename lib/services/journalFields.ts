import type { TradeJournalChoice } from "@/types"

/**
 * The controlled vocabularies behind the trade journal form.
 *
 * One module so the dropdowns, the API validator and the CSV export can never
 * disagree about what a tag means. Adding a value here is all it takes for the
 * three of them to accept it — only `strategy`, `timeframe`, `killzone` and
 * `exitReason` are additionally pinned by a CHECK constraint in the database,
 * so extending *those* four needs a migration as well.
 */

export const STRATEGIES = ["orderflow", "pa", "macro"] as const
export const TIMEFRAMES = ["5m", "15m", "1h"] as const
export const KILLZONES = ["asia", "london", "nyam", "nypm", "outside"] as const
export const EXIT_REASONS = ["tp1", "tp2", "sl", "be", "manual"] as const

/**
 * `none` is a stored value, not an empty one: "I reviewed this and there was no
 * mistake" has to stay distinguishable from "I have not reviewed it yet". A
 * clean trade is the goal, so it gets its own tag rather than a blank.
 */
export const MISTAKES = [
  "none",
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

/** Whether `value` is an accepted option for `field`. */
export function isChoice(field: TradeJournalChoice, value: unknown): boolean {
  return typeof value === "string" && (CHOICES[field] as readonly string[]).includes(value)
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
  none: "No mistake",
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
