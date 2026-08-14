/** A single manually-entered spot buy or sell. */
export interface SpotEntry {
  id: string
  ticker: string
  side: "BUY" | "SELL"
  qty: number
  price: number
  tradedAt: string // ISO string
}

/** One ticker's current state, after replaying every entry in trade order. */
export interface SpotHolding {
  ticker: string
  /** Units currently held. 0 once the position has been fully sold. */
  qty: number
  /** Remaining cost basis in USD. 0 when qty is 0. */
  costBasis: number
  /** costBasis / qty, or null when nothing is held (a closed position has no average). */
  avgEntry: number | null
  /** Latest market price, or null when no price feed is available for this ticker. */
  currentPrice: number | null
  /** qty * currentPrice, or null without a price. */
  marketValue: number | null
  /** marketValue - costBasis, or null without a price. */
  unrealisedPnl: number | null
  /** unrealisedPnl / costBasis * 100, or null without a price or with no basis. */
  unrealisedPct: number | null
  /** Realised PnL banked from every SELL, using the average cost at sale time. */
  realisedPnl: number
  /** Total USD spent on buys, across all cycles. */
  totalInvested: number
  buyCount: number
  sellCount: number
}

/**
 * One point on a ticker's DCA line. `avgEntry` is null while nothing is held,
 * which breaks the chart line across gaps rather than drawing through them.
 */
export interface DcaPoint {
  date: string // YYYY-MM-DD
  avgEntry: number | null
  market: number | null
  /** Set on days the user actually bought or sold, for scatter markers. */
  buyPrice?: number
  sellPrice?: number
}

/** One point on the whole-portfolio value chart. */
export interface PortfolioPoint {
  date: string // YYYY-MM-DD
  /** Market value of everything held that day. Null before any price is known. */
  value: number | null
  /** Cumulative net cash put in (buys minus sells) up to that day. */
  invested: number
}

/** Per-ticker slice of the allocation breakdown. */
export interface AllocationSlice {
  ticker: string
  value: number
  pct: number
}

/** Daily closes for one ticker, oldest first. */
export interface PriceSeries {
  ticker: string
  points: { day: string; close: number }[]
}
