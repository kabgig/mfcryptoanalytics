import { Trade, StatsResult } from "@/types"

/**
 * Derives all dashboard statistics and chart data from a list of trades.
 * No data fetching — pure computation over the provided trades array.
 */
export function computeStats(trades: Trade[]): StatsResult {
  const tradeCount = trades.length

  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0)

  const wins = trades.filter((t) => t.pnl > 0).length
  const winRate = tradeCount > 0 ? (wins / tradeCount) * 100 : 0

  // Build cumulative PnL chart data sorted by closeTime
  let running = 0
  const chartData = trades
    .slice()
    .sort((a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime())
    .map((t) => {
      running += t.pnl
      return {
        date: t.closeTime.slice(0, 10), // "YYYY-MM-DD"
        cumulativePnl: parseFloat(running.toFixed(2)),
      }
    })

  return {
    totalPnl: parseFloat(totalPnl.toFixed(2)),
    winRate: parseFloat(winRate.toFixed(1)),
    tradeCount,
    chartData,
  }
}
