import type { Trade } from "@/types"

export interface ExchangeChartPoint {
  date: string
  [exchange: string]: string | number
}

/**
 * Builds a time-series dataset where each point is a calendar date.
 * Each exchange key holds the cumulative PnL of ALL trades on that exchange
 * from the beginning of history up to and including that date.
 * Values are carried forward on dates that have no trades for that exchange,
 * producing a step-function per-exchange line.
 */
export function computeExchangePnl(trades: Trade[]): {
  points: ExchangeChartPoint[]
  exchanges: string[]
} {
  if (trades.length === 0) return { points: [], exchanges: [] }

  // Sum PnL per calendar date + exchange
  const dailyExchange = new Map<string, Map<string, number>>()
  const allExchanges = new Set<string>()

  for (const trade of trades) {
    const date = trade.closeTime.slice(0, 10)
    const ex = trade.exchange
    allExchanges.add(ex)
    if (!dailyExchange.has(date)) dailyExchange.set(date, new Map())
    const exMap = dailyExchange.get(date)!
    exMap.set(ex, (exMap.get(ex) ?? 0) + trade.pnl)
  }

  const exchanges = Array.from(allExchanges).sort()
  const dates = Array.from(dailyExchange.keys()).sort()

  // Running cumulative per exchange (all start at 0)
  const running: Record<string, number> = {}
  for (const ex of exchanges) running[ex] = 0

  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

  const points: ExchangeChartPoint[] = dates.map((isoDate) => {
    const exMap = dailyExchange.get(isoDate)!
    for (const [ex, pnl] of exMap.entries()) {
      running[ex] = parseFloat((running[ex] + pnl).toFixed(2))
    }

    const point: ExchangeChartPoint = { date: fmt.format(new Date(isoDate + "T00:00:00")) }
    for (const ex of exchanges) {
      point[ex] = running[ex]
    }
    return point
  })

  return { points, exchanges }
}
