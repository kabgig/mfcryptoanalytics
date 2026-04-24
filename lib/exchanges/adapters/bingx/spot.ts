import { Trade } from "@/types"
import { buildSignedQuery } from "./auth"
import { matchFifo, SpotFill } from "@/lib/exchanges/shared/fifo"

const BASE_URL = "https://open-api.bingx.com"
const LOOKBACK_DAYS = 90
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const PAGE_SIZE = 100

interface BingXHistoryOrder {
  orderId: string
  symbol: string
  side: string              // BUY | SELL
  type: string
  origQty: string
  executedQty: string
  cummulativeQuoteQty: string
  price: string
  status: string
  time: number
  updateTime: number
  fee: string
  feeAsset: string
}

interface BingXHistoryOrdersResponse {
  code: number
  msg: string
  data: {
    orders: BingXHistoryOrder[]
    total: number
  }
}

/**
 * Fetches filled spot orders from BingX for each symbol and computes PnL via FIFO matching.
 * Uses GET /openApi/spot/v1/trade/historyOrders with 7-day windows over 90 days.
 */
export async function fetchSpotTrades(
  apiKey: string,
  apiSecret: string,
  symbols: string[]
): Promise<Trade[]> {
  const trades: Trade[] = []

  for (const symbol of symbols) {
    const fills = await fetchAllFillsForSymbol(apiKey, apiSecret, symbol)
    const matched = matchFifo(fills, "BingX Spot", "bingx-spot")
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
    let pageIndex = 1
    let hasMore = true

    while (hasMore) {
      const query = buildSignedQuery(
        {
          symbol,
          status: "FILLED",
          startTime: String(window.startTime),
          endTime: String(window.endTime),
          pageIndex: String(pageIndex),
          pageSize: String(PAGE_SIZE),
        },
        apiSecret
      )

      const res = await fetch(
        `${BASE_URL}/openApi/spot/v1/trade/historyOrders?${query}`,
        { headers: { "X-BX-APIKEY": apiKey } }
      )

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`BingX spot historyOrders error ${res.status} (${symbol}): ${body}`)
      }

      const data: BingXHistoryOrdersResponse = await res.json()

      if (data.code !== 0) {
        throw new Error(`BingX spot historyOrders API error ${data.code}: ${data.msg} (${symbol})`)
      }

      const orders = data.data?.orders ?? []

      for (const order of orders) {
        const executedQty = parseFloat(order.executedQty)
        const quoteQty = parseFloat(order.cummulativeQuoteQty)
        if (!executedQty || !quoteQty) continue

        const effectivePrice = quoteQty / executedQty

        // Commission: use fee field if present, else 0
        const commissionQty = parseFloat(order.fee ?? "0") || 0

        allFills.push({
          id: order.orderId,
          symbol: order.symbol,
          price: effectivePrice,
          qty: executedQty,
          isBuyer: order.side === "BUY",
          time: order.time,
          commissionQty,
          commissionAsset: order.feeAsset ?? "",
        })
      }

      hasMore = orders.length === PAGE_SIZE
      pageIndex++
    }
  }

  // FIFO matching expects fills sorted oldest-first
  allFills.sort((a, b) => a.time - b.time)
  return allFills
}
