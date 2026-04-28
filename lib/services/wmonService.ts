import type { Trade } from "@/types"

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const

export interface WeekdaySeries {
  /** Full weekday name */
  day: string
  /** Cumulative PnL after the nth trade on this weekday (1-indexed occurrences) */
  data: number[]
}

/**
 * Groups trades by weekday of closeTime, sorts each group chronologically,
 * and builds a cumulative PnL series per weekday.
 *
 * Returns 7 series in Sun–Sat order. Series with no trades have data=[].
 */
export function computeWeeklyPnl(trades: Trade[]): WeekdaySeries[] {
  const buckets: Trade[][] = Array.from({ length: 7 }, () => [])

  for (const trade of trades) {
    const day = new Date(trade.closeTime).getDay() // 0=Sun … 6=Sat
    buckets[day].push(trade)
  }

  return buckets.map((bucket, i) => {
    bucket.sort((a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime())

    let running = 0
    const data = bucket.map((t) => {
      running += t.pnl
      return parseFloat(running.toFixed(2))
    })

    return { day: DAY_NAMES[i], data }
  })
}
