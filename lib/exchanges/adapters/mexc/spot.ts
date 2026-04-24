import { Trade } from "@/types"
import { signSpotParams } from "./auth"
import { MEXCSpotTrade } from "./types"
import { matchFifo, SpotFill } from "@/lib/exchanges/shared/fifo"

const BASE_URL = "https://api.mexc.com"
const LOOKBACK_DAYS = 90
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const DELAY_MS = 200

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fetchSpotTrades(
  apiKey: string,
  apiSecret: string,
  symbols: string[]
): Promise<Trade[]> {
  const trades: Trade[] = []

  for (const symbol of symbols) {
    const fills = await fetchAllFillsForSymbol(apiKey, apiSecret, symbol)
    trades.push(...matchFifo(fills, "MEXC Spot", "mexc-spot"))
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
  const fills: SpotFill[] = []

  let cursor = start

  while (cursor < now) {
    const endTime = Math.min(cursor + WINDOW_MS, now)

    const params = await signSpotParams(
      { symbol, startTime: cursor, endTime, limit: 1000 },
      apiSecret
    )

    const res = await fetch(
      `${BASE_URL}/api/v3/myTrades?${params.toString()}`,
      { headers: { "X-MEXC-APIKEY": apiKey } }
    )

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`MEXC Spot myTrades error ${res.status} (${symbol}): ${body}`)
    }

    const raw: MEXCSpotTrade[] = await res.json()

    for (const f of raw) {
      fills.push({
        id: String(f.id),
        symbol: f.symbol,
        price: parseFloat(f.price),
        qty: parseFloat(f.qty),
        isBuyer: f.isBuyer,
        time: f.time,
        commissionQty: parseFloat(f.commission),
        commissionAsset: f.commissionAsset,
      })
    }

    cursor = endTime + 1
    await sleep(DELAY_MS)
  }

  fills.sort((a, b) => a.time - b.time)
  return fills
}
