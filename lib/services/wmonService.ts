import type { Trade } from "@/types"

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const

export interface WeekdayChartPoint {
  date: string // e.g. "Apr 1"
  [day: string]: string | number
}

/**
 * Builds a time-series dataset where each point is a calendar date.
 * Each weekday key holds the cumulative PnL of ALL trades that closed on
 * that weekday, from the beginning of history up to and including that date.
 * Values are carried forward on dates that don't belong to that weekday,
 * producing a step-function per weekday line.
 */
export function computeWeeklyPnl(trades: Trade[]): WeekdayChartPoint[] {
  if (trades.length === 0) return []

  // Sum PnL per calendar date (YYYY-MM-DD)
  const dailyPnl = new Map<string, number>()
  for (const trade of trades) {
    const day = trade.closeTime.slice(0, 10)
    dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + trade.pnl)
  }

  // Sorted unique dates
  const dates = Array.from(dailyPnl.keys()).sort()

  // Running cumulative per weekday (all start at 0)
  const running: Record<string, number> = {}
  for (const d of DAY_NAMES) running[d] = 0

  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

  return dates.map((isoDate) => {
    const d = new Date(isoDate + "T00:00:00")
    const weekday = DAY_NAMES[d.getDay()]
    running[weekday] = parseFloat((running[weekday] + (dailyPnl.get(isoDate) ?? 0)).toFixed(2))

    const point: WeekdayChartPoint = { date: fmt.format(d) }
    for (const name of DAY_NAMES) {
      point[name] = running[name]
    }
    return point
  })
}
