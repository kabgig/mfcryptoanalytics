import { Trade } from "@/types"
import { buildAuthHeaders } from "./auth"
import { BybitExecutionResponse } from "./types"
import { matchFifo, SpotFill } from "@/lib/exchanges/shared/fifo"

const BASE_URL = "https://api.bybit.com"
const LOOKBACK_DAYS = 90
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Fetches spot execution fills for each symbol and computes PnL via FIFO matching.
 */
export async function fetchSpotTrades(
  apiKey: string,
  apiSecret: string,
  symbols: string[]
): Promise<Trade[]> {
  const trades: Trade[] = []

  for (const symbol of symbols) {
    const fills = await fetchAllFillsForSymbol(apiKey, apiSecret, symbol)
    const matched = matchFifo(fills, "Bybit Spot", "bybit-spot")
    trades.push(...matched)
  }

  return trades
}

async function fetchAllFillsForSymbol(
  apiKey: string,
  apiSecret: string,
  symbol: string
): Promise<SpotFill[]> {
  const now = Date.now()
  const start = now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000

  const windows: Array<{ startTime: number; endTime: number }> = []
  let cursor = start
  while (cursor < now) {
    const endTime = Math.min(cursor + WINDOW_MS, now)
    windows.push({ startTime: cursor, endTime })
    cursor = endTime + 1
  }

  const allFills: SpotFill[] = []

  for (const window of windows) {
    let nextCursor: string | undefined

    do {
      const params: Record<string, string> = {
        category: "spot",
        symbol,
        limit: "100",
        startTime: String(window.startTime),
        endTime: String(window.endTime),
      }
      if (nextCursor) params.cursor = nextCursor

      const queryString = new URLSearchParams(params).toString()
      const headers = await buildAuthHeaders(queryString, apiKey, apiSecret)

      const res = await fetch(
        `${BASE_URL}/v5/execution/list?${queryString}`,
        { headers }
      )

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Bybit spot execution error ${res.status} (${symbol}): ${body}`)
      }

      const data: BybitExecutionResponse = await res.json()

      if (data.retCode !== 0) {
        throw new Error(
          `Bybit spot execution API error ${data.retCode}: ${data.retMsg}`
        )
      }

      for (const e of data.result.list) {
        allFills.push({
          id: e.execId,
          symbol: e.symbol,
          price: parseFloat(e.execPrice),
          qty: parseFloat(e.execQty),
          isBuyer: e.side === "Buy",
          time: parseInt(e.execTime),
          commissionQty: parseFloat(e.execFee),
          commissionAsset: e.feeCurrency,
        })
      }

      nextCursor = data.result.nextPageCursor || undefined
    } while (nextCursor)
  }

  // Sort oldest-first for correct FIFO matching
  return allFills.sort((a, b) => a.time - b.time)
}
