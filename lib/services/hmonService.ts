import type { Trade } from "@/types"

export const HOUR_NAMES = Array.from({ length: 24 }, (_, i) =>
  `${String(i).padStart(2, "0")}h`
)

export interface HourlyChartPoint {
  date: string
  [hour: string]: string | number
}

// ── Session view ──────────────────────────────────────────────────────────────

export const SESSION_NAMES = ["Night", "Morning", "Afternoon", "Evening"] as const
export type SessionName = typeof SESSION_NAMES[number]

export const SESSION_HOURS: Record<SessionName, number[]> = {
  Night:     [0, 1, 2, 3, 4, 5],
  Morning:   [6, 7, 8, 9, 10, 11],
  Afternoon: [12, 13, 14, 15, 16, 17],
  Evening:   [18, 19, 20, 21, 22, 23],
}

// Map each hour → its session name for fast lookup
const HOUR_TO_SESSION: SessionName[] = Array.from({ length: 24 }, (_, h) => {
  for (const [name, hours] of Object.entries(SESSION_HOURS) as [SessionName, number[]][]) {
    if (hours.includes(h)) return name
  }
  return "Night"
})

export const SESSION_COLORS: Record<SessionName, string> = {
  Night:     "#6366f1",
  Morning:   "#f59e0b",
  Afternoon: "#22c55e",
  Evening:   "#f87171",
}

/**
 * Same step-function algorithm as computeHourlyPnl, but collapses hours
 * into 4 session buckets (Night / Morning / Afternoon / Evening).
 */
export function computeSessionPnl(
  trades: Trade[],
  timeField: "closeTime" | "openTime"
): HourlyChartPoint[] {
  if (trades.length === 0) return []

  const dailySession = new Map<string, Map<SessionName, number>>()
  for (const trade of trades) {
    const iso = trade[timeField]
    const date = iso.slice(0, 10)
    const hour = parseInt(iso.slice(11, 13), 10)
    const session = HOUR_TO_SESSION[hour]
    if (!dailySession.has(date)) dailySession.set(date, new Map())
    const sessionMap = dailySession.get(date)!
    sessionMap.set(session, (sessionMap.get(session) ?? 0) + trade.pnl)
  }

  const dates = Array.from(dailySession.keys()).sort()

  const running: Record<string, number> = {}
  for (const s of SESSION_NAMES) running[s] = 0

  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

  return dates.map((isoDate) => {
    const sessionMap = dailySession.get(isoDate)!
    for (const [session, pnl] of sessionMap.entries()) {
      running[session] = parseFloat((running[session] + pnl).toFixed(2))
    }

    const point: HourlyChartPoint = { date: fmt.format(new Date(isoDate + "T00:00:00")) }
    for (const s of SESSION_NAMES) {
      point[s] = running[s]
    }
    return point
  })
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
