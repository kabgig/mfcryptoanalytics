import { Trade } from "@/types"
import { buildSignedQuery } from "./auth"
import { BingXPositionHistoryResponse } from "./types"

const BASE_URL = "https://open-api.bingx.com"
const LOOKBACK_DAYS = 90
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const PAGE_SIZE = 100

/**
 * Fetches all closed perpetual futures positions from BingX for the past 90 days.
 * Uses GET /openApi/swap/v1/trade/positionHistory, paginated with pageIndex.
 * Iterates in 7-day windows to stay within the API's time range limits.
 */
export async function fetchFuturesTrades(
  apiKey: string,
  apiSecret: string
): Promise<Trade[]> {
  const now = Date.now()
  const start = now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000

  const windows: Array<{ startTs: number; endTs: number }> = []
  let cursor = start
  while (cursor < now) {
    const endTs = Math.min(cursor + WINDOW_MS, now)
    windows.push({ startTs: cursor, endTs })
    cursor = endTs + 1
  }

  const trades: Trade[] = []

  for (const window of windows) {
    let pageIndex = 1
    let hasMore = true

    while (hasMore) {
      const query = buildSignedQuery(
        {
          startTs: String(window.startTs),
          endTs: String(window.endTs),
          pageIndex: String(pageIndex),
          pageSize: String(PAGE_SIZE),
        },
        apiSecret
      )

      const res = await fetch(
        `${BASE_URL}/openApi/swap/v1/trade/positionHistory?${query}`,
        { headers: { "X-BX-APIKEY": apiKey } }
      )

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`BingX positionHistory error ${res.status}: ${body}`)
      }

      const data: BingXPositionHistoryResponse = await res.json()

      if (data.code !== 0) {
        throw new Error(`BingX positionHistory API error ${data.code}: ${data.msg}`)
      }

      const records = data.data?.positionHistoryVoList ?? []

      for (const r of records) {
        const pnl = parseFloat(r.realisedPnl)
        if (isNaN(pnl)) continue

        trades.push({
          id: `bingx-futures-${r.positionId}`,
          exchange: "BingX Futures",
          ticker: r.symbol.replace("-", ""),
          positionSize: Math.abs(parseFloat(r.positionAmt)),
          tp: null,
          sl: null,
          openTime: new Date(r.openTime).toISOString(),
          closeTime: new Date(r.closeTime).toISOString(),
          pnl,
          market: "futures" as const,
        })
      }

      hasMore = records.length === PAGE_SIZE
      pageIndex++
    }
  }

  return trades
}
