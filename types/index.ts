export interface Trade {
  id: string
  exchange: string
  ticker: string
  positionSize: number
  tp: number | null
  sl: number | null
  openTime: string  // ISO string
  closeTime: string // ISO string
  pnl: number
  market?: "spot" | "futures"
  side?: "long" | "short"
}

/** The three journalling moments of a trade. */
export type TradeNotePhase = "before" | "during" | "after"

/** A single trade's journal. A phase is absent when the user wrote nothing. */
export type TradeNotes = Partial<Record<TradeNotePhase, string>>

/**
 * Every note a user has, keyed by `tradeKey(exchange, id)` — trade ids are only
 * unique per exchange, so the exchange must be part of the key.
 */
export type TradeNotesMap = Record<string, TradeNotes>

/**
 * Direction the user was trading. Distinct from `Trade.side` on purpose: `side`
 * is whatever the exchange reported (only Bybit and Bitunix report one), while
 * bias is the user's own answer. The UI derives a bias from `side` when there is
 * one and lets a manual override win over it — `side` is never rewritten.
 */
export type TradeBias = "buy" | "sell"

/** The journal fields that take exactly one value from a controlled list. */
export type TradeJournalSingleChoice = "strategy" | "timeframe" | "killzone"

/**
 * The journal fields that take a list of values from a controlled list. A trade
 * can scale out at TP1 and be stopped out of the runner, and one that went wrong
 * usually went wrong in more than one way.
 */
export type TradeJournalMultiChoice = "exitReason" | "mistake" | "emotion"

/** Every journal field backed by a controlled list, single- or multi-valued. */
export type TradeJournalChoice = TradeJournalSingleChoice | TradeJournalMultiChoice

/**
 * Everything the user records about one trade by hand: the corrections to what
 * the exchange reported (tp1/sl/bias) and the journal proper — the plan made
 * before the entry and the review written after the exit.
 *
 * A field is absent when it was never set, in which case the exchange's own
 * value stands (for bias, the value derived from `side`; for rr, the figure
 * computed from entry/tp1/sl). A multi-valued field is absent rather than an
 * empty array when nothing is selected — `[]` is never stored, so "has the user
 * set this?" stays a single `=== undefined` check across every field.
 *
 * The accepted values for the choice fields live in
 * lib/services/journalFields.ts, deliberately not in this type: `exitReason`,
 * `mistake` and `emotion` are open vocabularies that grow without a migration.
 */
export interface TradeOverride {
  // — corrections to the exchange's own numbers —
  tp1?: number
  sl?: number
  bias?: TradeBias
  // — the plan, before the entry —
  strategy?: string
  timeframe?: string
  killzone?: string
  entry?: number
  tp2?: number
  riskPct?: number
  /** Set only when the user overrides the R:R computed from entry/tp1/sl. */
  rr?: number
  // — the review, after the exit —
  rulesOK?: boolean
  /** Several are possible: scaled out at TP1, then stopped out of the runner. */
  exitReason?: string[]
  mistake?: string[]
  emotion?: string[]
}

/**
 * Every override a user has, keyed by `tradeKey(exchange, id)` — same keying as
 * TradeNotesMap, and for the same reason: ids are only unique per exchange.
 */
export type TradeOverridesMap = Record<string, TradeOverride>

export interface ExchangeAdapter {
  name: string
  fetchTrades(walletAddress?: string): Promise<Trade[]>
}

export interface WalletUser {
  address: string // sole identity — no email/password
}

export interface StatsResult {
  totalPnl: number
  winRate: number
  tradeCount: number
  /** Total gross profit / total gross loss. null when there are no losing trades. */
  profitFactor: number | null
  /** Average winning trade / average losing trade. null when there are no losing trades. */
  rrr: number | null
  /** Largest peak-to-trough decline in cumulative PnL (always >= 0). */
  maxDrawdown: number
  chartData: { date: string; cumulativePnl: number }[]
}
