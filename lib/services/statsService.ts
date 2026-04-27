import { Trade, StatsResult } from "@/types"

/**
 * Derives all dashboard statistics and chart data from a list of trades.
 * No data fetching — pure computation over the provided trades array.
 */
export function computeStats(trades: Trade[]): StatsResult {
  const tradeCount = trades.length

  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0)

  const winPnls = trades.filter((t) => t.pnl > 0).map((t) => t.pnl)
  const lossPnls = trades.filter((t) => t.pnl < 0).map((t) => t.pnl)

  const winRate = tradeCount > 0 ? (winPnls.length / tradeCount) * 100 : 0

  // Profit Factor: gross profit / gross loss
  const grossProfit = winPnls.reduce((sum, p) => sum + p, 0)
  const grossLoss = Math.abs(lossPnls.reduce((sum, p) => sum + p, 0))
  const profitFactor = grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(2)) : null

  // RRR: average win / average loss
  const avgWin = winPnls.length > 0 ? grossProfit / winPnls.length : 0
  const avgLoss = lossPnls.length > 0 ? grossLoss / lossPnls.length : 0
  const rrr = avgLoss > 0 ? parseFloat((avgWin / avgLoss).toFixed(2)) : null

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

  // Max Drawdown: largest peak-to-trough decline in cumulative PnL
  let peak = -Infinity
  let maxDrawdown = 0
  for (const { cumulativePnl } of chartData) {
    if (cumulativePnl > peak) peak = cumulativePnl
    const dd = peak - cumulativePnl
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  return {
    totalPnl: parseFloat(totalPnl.toFixed(2)),
    winRate: parseFloat(winRate.toFixed(1)),
    tradeCount,
    profitFactor,
    rrr,
    maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
    chartData,
  }
}
