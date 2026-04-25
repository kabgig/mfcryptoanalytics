import { Trade } from "@/types"
import { buildSignedQuery } from "./auth"
import { BingXIncomeResponse } from "./types"

const BASE_URL = "https://open-api.bingx.com"
const LOOKBACK_DAYS = 90
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const LIMIT = 1000
const DELAY_MS = 250 // stay within 5 req/s rate limit

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetches all realized PnL entries from BingX perpetual futures for the past 90 days.
 * Uses GET /openApi/swap/v2/user/income with incomeType=REALIZED_PNL.
 * Iterates in 7-day windows with limit=1000 per window.
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
    const query = await buildSignedQuery(
      {
        incomeType: "REALIZED_PNL",
        startTime: String(window.startTime),
        endTime: String(window.endTime),
        limit: String(LIMIT),
      },
      apiSecret
    )

    const res = await fetch(
      `${BASE_URL}/openApi/swap/v2/user/income?${query}`,
      { headers: { "X-BX-APIKEY": apiKey } }
    )

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`BingX user/income error ${res.status}: ${body}`)
    }

    const data: BingXIncomeResponse = await res.json()

    if (data.code !== 0) {
      if (data.code === 100410) {
        // Rate-limit ban — extract unblock timestamp from the message if present
        const tsMatch = /after\s+(\d{10,})/i.exec(data.msg ?? '')
        if (tsMatch) {
          const unblockMs = Number(tsMatch[1])
          // BingX returns ms if > 1e12, otherwise seconds
          const unblockDate = new Date(unblockMs > 1e12 ? unblockMs : unblockMs * 1000)
          const formatted = unblockDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          throw new Error(`BingX rate limit active — try again after ${formatted}`)
        }
        throw new Error('BingX rate limit active — please wait a few minutes and try again')
      }
      throw new Error(`BingX user/income API error ${data.code}: ${data.msg}`)
    }

    const records = data.data ?? []

    for (const r of records) {
      const pnl = parseFloat(r.income)
      if (isNaN(pnl)) continue

      trades.push({
        id: `bingx-futures-${r.tranId}-${r.tradeId}`,
        exchange: "BingX",
        ticker: r.symbol.replace("-", ""),
        positionSize: 0,
        tp: null,
        sl: null,
        openTime: new Date(r.time).toISOString(),
        closeTime: new Date(r.time).toISOString(),
        pnl,
        market: "futures" as const,
      })
    }

    await sleep(DELAY_MS)
  }

  return trades
}
