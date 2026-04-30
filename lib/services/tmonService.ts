import type { Trade } from "@/types"

export interface TickerChartPoint {
  date: string
  [ticker: string]: string | number
}

/**
 * Builds a time-series dataset where each point is a calendar date.
 * Each ticker key holds the cumulative PnL of ALL trades on that ticker
 * from the beginning of history up to and including that date.
 * Values are carried forward on dates that have no trades for that ticker.
 *
 * Only the top `topN` tickers by absolute final cumulative PnL are returned.
 * Pass Infinity to include all tickers.
 */
export function computeTickerPnl(
  trades: Trade[],
  topN: number
): { points: TickerChartPoint[]; tickers: string[] } {
  if (trades.length === 0) return { points: [], tickers: [] }

  // Sum PnL per calendar date + ticker
  const dailyTicker = new Map<string, Map<string, number>>()
  const allTickers = new Set<string>()

  for (const trade of trades) {
    const date = trade.closeTime.slice(0, 10)
    const ticker = trade.ticker
    allTickers.add(ticker)
    if (!dailyTicker.has(date)) dailyTicker.set(date, new Map())
    const tickerMap = dailyTicker.get(date)!
    tickerMap.set(ticker, (tickerMap.get(ticker) ?? 0) + trade.pnl)
  }

  const dates = Array.from(dailyTicker.keys()).sort()

  // Compute final cumulative per ticker across all dates to determine top N
  const finalCumulative: Record<string, number> = {}
  for (const t of allTickers) finalCumulative[t] = 0

  for (const isoDate of dates) {
    const tickerMap = dailyTicker.get(isoDate)!
    for (const [ticker, pnl] of tickerMap.entries()) {
      finalCumulative[ticker] = parseFloat((finalCumulative[ticker] + pnl).toFixed(2))
    }
  }

  // Rank by absolute final cumulative PnL, take top N
  const ranked = Object.entries(finalCumulative)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, isFinite(topN) ? topN : undefined)
    .map(([ticker]) => ticker)

  // Build step-function series for selected tickers only
  const running: Record<string, number> = {}
  for (const t of ranked) running[t] = 0

  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

  const points: TickerChartPoint[] = dates.map((isoDate) => {
    const tickerMap = dailyTicker.get(isoDate)!
    for (const ticker of ranked) {
      const pnl = tickerMap.get(ticker) ?? 0
      if (pnl !== 0) {
        running[ticker] = parseFloat((running[ticker] + pnl).toFixed(2))
      }
    }

    const point: TickerChartPoint = { date: fmt.format(new Date(isoDate + "T00:00:00")) }
    for (const t of ranked) {
      point[t] = running[t]
    }
    return point
  })

  return { points, tickers: ranked }
}
