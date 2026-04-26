import { BinanceAdapter } from "@/lib/exchanges/adapters/binance"
import { BybitAdapter } from "@/lib/exchanges/adapters/bybit"
import { OKXAdapter } from "@/lib/exchanges/adapters/okx"
import { BingXAdapter } from "@/lib/exchanges/adapters/bingx"
import { MEXCAdapter } from "@/lib/exchanges/adapters/mexc"
import { getIfFresh, upsertTrades } from "@/lib/db/trades"
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
    // Single query: check freshness + fetch cached trades
    const t0 = Date.now()
    const cached = await getIfFresh(telegramId, exchange)
    console.log(`[trades] ${exchange} getIfFresh=${cached.fresh} (${Date.now() - t0}ms)`)

    if (!force && cached.fresh) {
      console.log(`[trades] ${exchange} served ${cached.trades.length} trades FROM CACHE`)
      return Response.json({ trades: cached.trades, fromCache: true })
    }

    // Fetch live from exchange
    const t2 = Date.now()
    const trades = await fetchFromExchange(body)
    console.log(`[trades] ${exchange} fetched ${trades.length} trades FROM EXCHANGE (${Date.now() - t2}ms)`)

    // Ensure user row exists before writing to FK-constrained tables
    const sql = (await import("@/lib/db")).getSql()
    await sql`
      INSERT INTO users (telegram_id, telegram_name)
      VALUES (${BigInt(telegramId)}, ${'unknown'})
      ON CONFLICT (telegram_id) DO NOTHING
    `

    const t3 = Date.now()
    await upsertTrades(telegramId, exchange, trades)
    console.log(`[trades] ${exchange} upserted to DB (${Date.now() - t3}ms)`)

    return Response.json({ trades, fromCache: false })
  } catch (err) {
    console.error(`[trades] ${exchange} ERROR:`, err)
    return Response.json({ error: String(err) }, { status: 502 })
  }
}

