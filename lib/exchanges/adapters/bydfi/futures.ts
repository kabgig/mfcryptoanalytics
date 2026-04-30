import { Trade } from "@/types"
import { buildAuthHeaders } from "./auth"
import { BYDFiPositionRecord } from "./types"

const BASE_URL = "https://api.bydfi.com/api"
const LOOKBACK_DAYS = 180 // 6 months (API limit)
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7-day max window per query

/**
 * Fetches all closed position PnL records from BYDFi Futures
 * for the past 180 days, paginated in 7-day windows.
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

  const allTrades: Trade[] = []

  for (const window of windows) {
    const params = new URLSearchParams({
      contractType: "FUTURE",
      startTime: String(window.startTime),
      endTime: String(window.endTime),
      limit: "1000",
    })
    const queryString = params.toString()
    const headers = await buildAuthHeaders(queryString, apiKey, apiSecret)

    const res = await fetch(
      `${BASE_URL}/v1/fapi/trade/position_history?${queryString}`,
      { headers }
    )

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`BYDFi position history error ${res.status}: ${body}`)
    }

    const data: BYDFiPositionRecord[] = await res.json()

    for (const r of data) {
      allTrades.push({
        id: `bydfi-futures-${r.id}`,
        exchange: "BYDFi",
        ticker: r.symbol,
        positionSize: r.openPositionVolume,
        tp: null,
        sl: null,
        openTime: new Date(r.updateTime).toISOString(),   // updateTime = open (per docs)
        closeTime: new Date(r.createTime).toISOString(),  // createTime = close (per docs)
        pnl: parseFloat(r.positionProfits),
        market: "futures" as const,
        side: r.positionSide === "LONG" ? "long" : r.positionSide === "SHORT" ? "short" : undefined,
      })
    }
  }

  return allTrades
}
