import type { Trade } from "@/types"

export interface SideStats {
  tradeCount: number
  winCount: number
  lossCount: number
  winRate: number    // 0–100
  totalPnl: number
  avgPnl: number
  bestTrade: number
  worstTrade: number
}

export interface LvsSResult {
  long: SideStats
  short: SideStats
  unknownCount: number
  unknownExchanges: string[]
}

function statsFor(bucket: Trade[]): SideStats {
  const tradeCount = bucket.length
  const winCount = bucket.filter((t) => t.pnl > 0).length
  const lossCount = bucket.filter((t) => t.pnl < 0).length
  const totalPnl = parseFloat(bucket.reduce((s, t) => s + t.pnl, 0).toFixed(2))
  const avgPnl = tradeCount > 0 ? parseFloat((totalPnl / tradeCount).toFixed(2)) : 0
  const winRate = tradeCount > 0 ? parseFloat(((winCount / tradeCount) * 100).toFixed(1)) : 0
  const bestTrade = bucket.length > 0 ? Math.max(...bucket.map((t) => t.pnl)) : 0
  const worstTrade = bucket.length > 0 ? Math.min(...bucket.map((t) => t.pnl)) : 0
  return { tradeCount, winCount, lossCount, winRate, totalPnl, avgPnl, bestTrade, worstTrade }
}

export function computeLvsS(trades: Trade[]): LvsSResult {
  const longTrades = trades.filter((t) => t.side === "long")
  const shortTrades = trades.filter((t) => t.side === "short")
  const unknownTrades = trades.filter((t) => !t.side)

  const unknownExchanges = Array.from(
    new Set(unknownTrades.map((t) => t.exchange))
  ).sort()

  return {
    long: statsFor(longTrades),
    short: statsFor(shortTrades),
    unknownCount: unknownTrades.length,
    unknownExchanges,
  }
}
