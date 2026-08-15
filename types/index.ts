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
