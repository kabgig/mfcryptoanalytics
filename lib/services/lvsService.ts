import { resolveTrades } from "@/lib/services/overridesService"
import type { Trade, TradeOverridesMap } from "@/types"

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
  /** Trades with neither an exchange-reported side nor a Bias set by hand. */
  unknownCount: number
  /** Exchanges those still-unbucketed trades came from. */
  unknownExchanges: string[]
  /** How many of the bucketed trades got there from a hand-set Bias. */
  manualCount: number
  /**
   * Exchanges in this set that never report long/short themselves — for these,
   * a trade only lands in a bucket once the user sets its Bias. Derived from the
   * trades rather than hardcoded, so an adapter that starts reporting a side
   * drops off the list on its own.
   */
  exchangesWithoutSide: string[]
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

/**
 * Splits a trade list into long and short.
 *
 * Buckets on the resolved *bias*, not on `side` directly: only Bybit and
 * Bitunix report a side at all, so before overrides existed every trade from
 * every other exchange fell into `unknown` and was silently left out of this
 * view. A Bias the user sets by hand (buy → long, sell → short) now counts, and
 * beats the exchange's own answer when both exist — `cached_trades.side` is
 * never rewritten, so this is purely a question of which bucket a trade is
 * counted in.
 */
export function computeLvsS(
  trades: Trade[],
  overrides: TradeOverridesMap = {}
): LvsSResult {
  const resolved = resolveTrades(trades, overrides)

  const longTrades = resolved.filter((t) => t.bias === "buy")
  const shortTrades = resolved.filter((t) => t.bias === "sell")
  const unknownTrades = resolved.filter((t) => t.bias === null)

  const unknownExchanges = Array.from(
    new Set(unknownTrades.map((t) => t.exchange))
  ).sort()

  // An exchange counts as reporting a side if any of its trades carries one.
  const reportsSide = new Set(resolved.filter((t) => t.side).map((t) => t.exchange))
  const exchangesWithoutSide = Array.from(new Set(resolved.map((t) => t.exchange)))
    .filter((exchange) => !reportsSide.has(exchange))
    .sort()

  return {
    long: statsFor(longTrades),
    short: statsFor(shortTrades),
    unknownCount: unknownTrades.length,
    unknownExchanges,
    manualCount: resolved.filter((t) => t.overridden.bias).length,
    exchangesWithoutSide,
  }
}
