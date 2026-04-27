import { Trade } from "@/types"
import { buildAuthHeaders } from "./auth"
import { BybitClosedPnlResponse } from "./types"

const BASE_URL = "https://api.bybit.com"
const LOOKBACK_DAYS = 90
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Fetches all closed PnL records from Bybit USDT Perpetual Futures
 * for the past 90 days, paginated via cursor in 7-day windows.
 */
export async function fetchFuturesTrades(
  apiKey: string,
  apiSecret: string
): Promise<Trade[]> {
  const now = Date.now()
  const start = now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000

  const windows: Array<{ startTime: number; endTime: number }> = []
  let cursor = start
  while (cursor < now) {
    const endTime = Math.min(cursor + WINDOW_MS, now)
    windows.push({ startTime: cursor, endTime })
    cursor = endTime + 1
  }

  const trades: Trade[] = []

  for (const window of windows) {
    let nextCursor: string | undefined

    do {
      const params: Record<string, string> = {
        category: "linear",
        limit: "100",
        startTime: String(window.startTime),
        endTime: String(window.endTime),
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
      console.log(`[Bybit] window=${new Date(window.startTime).toISOString()} retCode=${data.retCode} retMsg=${data.retMsg} count=${data.result?.list?.length ?? 'no-list'}`)

      if (data.retCode !== 0) {
        throw new Error(`Bybit closed-pnl API error ${data.retCode}: ${data.retMsg}`)
      }

      for (const r of data.result.list) {
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

      nextCursor = data.result.nextPageCursor || undefined
    } while (nextCursor)
  }

  return trades
}
