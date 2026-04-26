import { Trade } from "@/types"
import { buildAuthHeaders } from "./auth"
import { BitunixPositionHistoryResponse } from "./types"

const BASE_URL = "https://fapi.bitunix.com"
const LOOKBACK_DAYS = 180 // 6 months
const PAGE_SIZE = 100     // API maximum

/**
 * Fetches all closed position records from Bitunix Futures
 * for the past 180 days, paginated via skip/limit.
 */
export async function fetchFuturesTrades(
  apiKey: string,
  apiSecret: string
): Promise<Trade[]> {
  const now = Date.now()
  const startTime = now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000

  const allTrades: Trade[] = []
  let skip = 0

  while (true) {
    const params: Record<string, string | number> = {
      startTime,
      endTime: now,
      skip,
      limit: PAGE_SIZE,
    }

    const { headers, urlQueryString } = await buildAuthHeaders(params, apiKey, apiSecret)

    const res = await fetch(
      `${BASE_URL}/api/v1/futures/position/get_history_positions?${urlQueryString}`,
      { headers }
    )

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Bitunix position history error ${res.status}: ${body}`)
    }

    const data: BitunixPositionHistoryResponse = await res.json()

    if (data.code !== 0) {
      throw new Error(`Bitunix API error ${data.code}: ${data.msg}`)
    }

    const { positionList, total } = data.data

    for (const r of positionList) {
      const openDate = r.ctime ? new Date(Number(r.ctime)) : null
      const closeDate = r.mtime ? new Date(Number(r.mtime)) : null
      if (!openDate || isNaN(openDate.getTime()) || !closeDate || isNaN(closeDate.getTime())) continue

      allTrades.push({
        id: `bitunix-futures-${r.positionId}`,
        exchange: "Bitunix",
        ticker: r.symbol,
        positionSize: parseFloat(r.maxQty),
        tp: null,
        sl: null,
        openTime: openDate.toISOString(),
        closeTime: closeDate.toISOString(),
        pnl: parseFloat(r.realizedPNL),
        market: "futures" as const,
      })
    }

    skip += positionList.length
    if (skip >= total || positionList.length < PAGE_SIZE) break
  }

  return allTrades
}
