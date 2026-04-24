import { Trade } from "@/types"
import { signParams } from "./auth"
import { BinanceSpotTrade } from "./types"
import { matchFifo, SpotFill } from "@/lib/exchanges/shared/fifo"

const SPOT_BASE_URL = "https://api.binance.com"

export async function fetchSpotTrades(
  apiKey: string,
  apiSecret: string,
  symbols: string[]
): Promise<Trade[]> {
  const trades: Trade[] = []

  for (const symbol of symbols) {
    const fills = await fetchAllFillsForSymbol(apiKey, apiSecret, symbol)
    const matched = matchFifo(fills, "Binance Spot", "binance-spot")
    trades.push(...matched)
  }

  return trades
}

async function fetchAllFillsForSymbol(
  apiKey: string,
  apiSecret: string,
  symbol: string
): Promise<SpotFill[]> {
  const params = signParams({ symbol, limit: 1000 }, apiSecret)

  const res = await fetch(
    `${SPOT_BASE_URL}/api/v3/myTrades?${params.toString()}`,
    { headers: { "X-MBX-APIKEY": apiKey } }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Binance Spot myTrades error ${res.status} (${symbol}): ${body}`)
  }

  const raw: BinanceSpotTrade[] = await res.json()

  return raw
    .sort((a, b) => a.time - b.time)
    .map((f) => ({
      id: String(f.id),
      symbol: f.symbol,
      price: parseFloat(f.price),
      qty: parseFloat(f.qty),
      isBuyer: f.isBuyer,
      time: f.time,
      commissionQty: parseFloat(f.commission),
      commissionAsset: f.commissionAsset,
    }))
}
