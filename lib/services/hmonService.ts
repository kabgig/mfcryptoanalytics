import type { Trade } from "@/types"

export const HOUR_NAMES = Array.from({ length: 24 }, (_, i) =>
  `${String(i).padStart(2, "0")}h`
)

export interface HourlyChartPoint {
  date: string
  [hour: string]: string | number
}

/**
 * Builds a time-series dataset where each point is a calendar date.
 * Each hour key (00h–23h) holds the cumulative PnL of ALL trades whose
 * chosen time field (openTime or closeTime) falls in that UTC hour,
 * from the beginning of history up to and including that date.
 * Values are carried forward on dates where that hour had no trades,
 * producing a step-function per-hour line.
 */
export function computeHourlyPnl(
  trades: Trade[],
  timeField: "closeTime" | "openTime"
): HourlyChartPoint[] {
  if (trades.length === 0) return []

  // Sum PnL per calendar date + hour bucket
  const dailyHourly = new Map<string, Map<string, number>>()
  for (const trade of trades) {
    const iso = trade[timeField]
    const date = iso.slice(0, 10) // YYYY-MM-DD
    const hour = parseInt(iso.slice(11, 13), 10)
    const hourKey = HOUR_NAMES[hour]
    if (!dailyHourly.has(date)) dailyHourly.set(date, new Map())
    const hourMap = dailyHourly.get(date)!
    hourMap.set(hourKey, (hourMap.get(hourKey) ?? 0) + trade.pnl)
  }

  // Sorted unique dates
  const dates = Array.from(dailyHourly.keys()).sort()

  // Running cumulative per hour (all start at 0)
  const running: Record<string, number> = {}
  for (const h of HOUR_NAMES) running[h] = 0

  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

  return dates.map((isoDate) => {
    const hourMap = dailyHourly.get(isoDate)!
    for (const [hourKey, pnl] of hourMap.entries()) {
      running[hourKey] = parseFloat((running[hourKey] + pnl).toFixed(2))
    }

    const point: HourlyChartPoint = { date: fmt.format(new Date(isoDate + "T00:00:00")) }
    for (const h of HOUR_NAMES) {
      point[h] = running[h]
    }
    return point
  })
}
