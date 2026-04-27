import { Trade } from "@/types"
import { buildAuthHeaders } from "./auth"
import { BybitClosedPnlResponse } from "./types"

const BASE_URL = "https://api.bybit.com"
const LOOKBACK_DAYS = 90

/**
 * Fetches all closed PnL records from Bybit USDT Perpetual Futures
 * for the past 90 days using pure cursor pagination (no time windows).
 * Uses limit=200 (API max) to minimize the number of requests.
 */
export async function fetchFuturesTrades(
  apiKey: string,
  apiSecret: string
): Promise<Trade[]> {
  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  const trades: Trade[] = []
  let nextCursor: string | undefined

  do {
    const params: Record<string, string> = {
      category: "linear",
      limit: "200",
    }
    if (nextCursor) params.cursor = nextCursor

    const queryString = new URLSearchParams(params).toString()
    const headers = await buildAuthHeaders(queryString, apiKey, apiSecret)

    const res = await fetch(
      `${BASE_URL}/v5/position/closed-pnl?${queryString}`,
      { headers }
    )

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Bybit closed-pnl error ${res.status}: ${body}`)
    }

    const data: BybitClosedPnlResponse = await res.json()

    if (data.retCode !== 0) {
      throw new Error(`Bybit closed-pnl API error ${data.retCode}: ${data.retMsg}`)
    }

    let reachedCutoff = false
    for (const r of data.result.list) {
      const closeTs = parseInt(r.updatedTime)
      if (closeTs < cutoff) {
        reachedCutoff = true
        break
      }
      trades.push({
        id: `bybit-futures-${r.orderId}`,
        exchange: "Bybit",
        ticker: r.symbol,
        positionSize: parseFloat(r.closedSize),
        tp: null,
        sl: null,
        openTime: new Date(parseInt(r.createdTime)).toISOString(),
        closeTime: new Date(parseInt(r.updatedTime)).toISOString(),
        pnl: parseFloat(r.closedPnl),
        market: "futures" as const,
      })
    }

    if (reachedCutoff || !data.result.nextPageCursor) break
    nextCursor = data.result.nextPageCursor
  } while (true)

  return trades
}
