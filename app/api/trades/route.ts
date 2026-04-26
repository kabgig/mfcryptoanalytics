import { BinanceAdapter } from "@/lib/exchanges/adapters/binance"
import { BybitAdapter } from "@/lib/exchanges/adapters/bybit"
import { OKXAdapter } from "@/lib/exchanges/adapters/okx"
import { BingXAdapter } from "@/lib/exchanges/adapters/bingx"
import { MEXCAdapter } from "@/lib/exchanges/adapters/mexc"
import { isCacheFresh, getCachedTrades, upsertTrades } from "@/lib/db/trades"
import type { Trade } from "@/types"

export const dynamic = "force-dynamic"
export const preferredRegion = "sin1" // Singapore — avoids geo-blocks for BingX/MEXC

interface TradesRequestBody {
  telegramId: string
  exchange: string
  apiKey: string
  apiSecret: string
  passphrase?: string
  force?: boolean
}

async function fetchFromExchange(body: TradesRequestBody): Promise<Trade[]> {
  const { exchange, apiKey, apiSecret, passphrase = "" } = body
  switch (exchange) {
    case "Binance": return new BinanceAdapter(apiKey, apiSecret).fetchTrades()
    case "Bybit":   return new BybitAdapter(apiKey, apiSecret).fetchTrades()
    case "OKX":     return new OKXAdapter(apiKey, apiSecret, passphrase).fetchTrades()
    case "BingX":   return new BingXAdapter(apiKey, apiSecret).fetchTrades()
    case "MEXC":    return new MEXCAdapter(apiKey, apiSecret).fetchTrades()
    default:        throw new Error(`Unknown exchange: ${exchange}`)
  }
}

export async function POST(request: Request) {
  let body: TradesRequestBody

  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { telegramId, exchange, apiKey, apiSecret, force = false } = body

  if (!telegramId || !exchange || !apiKey || !apiSecret) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  try {
    // Serve from cache if fresh and not forced
    if (!force && await isCacheFresh(telegramId, exchange)) {
      const trades = await getCachedTrades(telegramId, exchange)
      return Response.json({ trades, fromCache: true })
    }

    // Fetch live from exchange
    const trades = await fetchFromExchange(body)
    await upsertTrades(telegramId, exchange, trades)

    return Response.json({ trades, fromCache: false })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 })
  }
}

