import { Trade } from "@/types"
import { signParams } from "./auth"
import { BinanceFuturesIncomeRecord } from "./types"

const FUTURES_BASE_URL = "https://fapi.binance.com"

// Binance futures income history covers the last 3 months.
// The API allows a max window of 7 days per call, so we paginate in 7-day chunks.
const LOOKBACK_DAYS = 90
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Fetches all REALIZED_PNL income records from Binance USDM Futures
 * for the past 90 days (paginated in 7-day windows).
 * Pass `since` (Unix ms) to only fetch records newer than the latest cached trade.
 */
export async function fetchFuturesTrades(
  apiKey: string,
  apiSecret: string,
  since?: number
): Promise<Trade[]> {
  const now = Date.now()
  const start = since ?? now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000

  const windows: Array<{ startTime: number; endTime: number }> = []
  let cursor = start
  while (cursor < now) {
    const endTime = Math.min(cursor + WINDOW_MS, now)
    windows.push({ startTime: cursor, endTime })
    cursor = endTime + 1
  }

  const allRecords: BinanceFuturesIncomeRecord[] = []

  for (const window of windows) {
    let page = 1
    while (true) {
      const params = await signParams(
        {
          incomeType: "REALIZED_PNL",
          startTime: window.startTime,
          endTime: window.endTime,
          limit: 1000,
          page,
        },
        apiSecret
      )

      const res = await fetch(
        `${FUTURES_BASE_URL}/fapi/v1/income?${params.toString()}`,
        { headers: { "X-MBX-APIKEY": apiKey } }
      )

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Binance Futures income error ${res.status}: ${body}`)
      }

      const records: BinanceFuturesIncomeRecord[] = await res.json()
      allRecords.push(...records)

      // If fewer than 1000 records were returned, this window is exhausted
      if (records.length < 1000) break
      page++
    }
  }

  return allRecords
    .filter((r) => r.symbol !== "") // skip non-trade entries
    .map((r) => ({
      id: `binance-futures-${r.tranId}`,
      exchange: "Binance",
      ticker: r.symbol,
      positionSize: 0,     // not available from income endpoint
      tp: null,
      sl: null,
      openTime: new Date(r.time).toISOString(),  // open time not available; use close time
      closeTime: new Date(r.time).toISOString(),
      pnl: parseFloat(r.income),
      market: "futures" as const,
    }))
}
