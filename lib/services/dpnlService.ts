import type { Trade } from "@/types"

export interface DPnLPoint {
  id: string
  ticker: string
  exchange: string
  x: number   // duration in hours
  y: number   // pnl
  win: boolean
}

export interface DPnLResult {
  wins: DPnLPoint[]
  losses: DPnLPoint[]
  avgWinDurationH: number
  avgLossDurationH: number
  avgWinPnl: number
  avgLossPnl: number
  noDurationExchanges: string[]
}

export function fmtDuration(hours: number): string {
  if (hours < 1 / 60) return `${Math.round(hours * 3600)}s`
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${hours.toFixed(1)}h`
  const days = Math.floor(hours / 24)
  const rem = hours % 24
  return rem < 0.5 ? `${days}d` : `${days}d ${Math.round(rem)}h`
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0
  return parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2))
}

export function computeDPnL(trades: Trade[]): DPnLResult {
  const noDurationSet = new Set<string>()

  const points: DPnLPoint[] = trades
    .map((t) => {
      const durationH = (new Date(t.closeTime).getTime() - new Date(t.openTime).getTime()) / 3_600_000
      // Skip trades where openTime === closeTime — no real duration data
      if (durationH <= 0) {
        noDurationSet.add(t.exchange)
        return null
      }
      return {
        id: t.id,
        ticker: t.ticker,
        exchange: t.exchange,
        x: parseFloat(durationH.toFixed(4)),
        y: t.pnl,
        win: t.pnl > 0,
      }
    })
    .filter((p): p is DPnLPoint => p !== null)

  const noDurationExchanges = Array.from(noDurationSet).sort()

  const wins = points.filter((p) => p.win)
  const losses = points.filter((p) => !p.win)

  return {
    wins,
    losses,
    avgWinDurationH: avg(wins.map((p) => p.x)),
    avgLossDurationH: avg(losses.map((p) => p.x)),
    avgWinPnl: avg(wins.map((p) => p.y)),
    avgLossPnl: avg(losses.map((p) => p.y)),
    noDurationExchanges,
  }
}
