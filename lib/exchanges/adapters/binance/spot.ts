import { Trade } from "@/types"
import { signParams } from "./auth"
import { BinanceSpotTrade } from "./types"

const SPOT_BASE_URL = "https://api.binance.com"

interface BuyLot {
  qty: number      // remaining base quantity in this lot
  price: number    // average cost per unit
  time: number     // Unix ms — becomes openTime when matched
  commission: number
  commissionAsset: string
}

/**
 * Fetches spot trades for each symbol, then computes PnL via FIFO cost-basis matching.
 * A "trade" (in our domain sense) is a complete round-trip: a buy lot fully consumed by a sell.
 */
export async function fetchSpotTrades(
  apiKey: string,
  apiSecret: string,
  symbols: string[]
): Promise<Trade[]> {
  const trades: Trade[] = []

  for (const symbol of symbols) {
    const fills = await fetchAllFillsForSymbol(apiKey, apiSecret, symbol)
    const matched = matchFifo(symbol, fills)
    trades.push(...matched)
  }

  return trades
}

async function fetchAllFillsForSymbol(
  apiKey: string,
  apiSecret: string,
  symbol: string
): Promise<BinanceSpotTrade[]> {
  const params = signParams({ symbol, limit: 1000 }, apiSecret)

  const res = await fetch(
    `${SPOT_BASE_URL}/api/v3/myTrades?${params.toString()}`,
    { headers: { "X-MBX-APIKEY": apiKey } }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Binance Spot myTrades error ${res.status} (${symbol}): ${body}`)
  }

  const fills: BinanceSpotTrade[] = await res.json()
  // Sort oldest-first for FIFO matching
  return fills.sort((a, b) => a.time - b.time)
}

/**
 * FIFO matching: buy fills go into a queue, sell fills drain from the front.
 * Each time a sell fully consumes one or more buy lots, we emit a Trade.
 */
function matchFifo(symbol: string, fills: BinanceSpotTrade[]): Trade[] {
  const buyQueue: BuyLot[] = []
  const result: Trade[] = []
  let tradeIndex = 0

  for (const fill of fills) {
    const price = parseFloat(fill.price)
    const qty = parseFloat(fill.qty)
    const commission = parseFloat(fill.commission)

    if (fill.isBuyer) {
      // Normalize commission to quote asset for cost basis
      const commissionInQuote =
        fill.commissionAsset === symbol.replace("USDT", "").replace("BTC", "")
          ? commission * price   // commission paid in base — convert to quote
          : commission           // already in quote (USDT / BNB treated as approximate)

      buyQueue.push({
        qty,
        price,
        time: fill.time,
        commission: commissionInQuote,
        commissionAsset: fill.commissionAsset,
      })
    } else {
      // Sell fill — drain FIFO buy queue
      let remainingSellQty = qty
      const sellCommissionInQuote =
        fill.commissionAsset === "USDT" ? commission : commission * price

      while (remainingSellQty > 1e-12 && buyQueue.length > 0) {
        const lot = buyQueue[0]
        const matchedQty = Math.min(lot.qty, remainingSellQty)
        const costBasis = lot.price * matchedQty + lot.commission * (matchedQty / lot.qty)
        const proceeds = price * matchedQty - sellCommissionInQuote * (matchedQty / qty)
        const pnl = proceeds - costBasis

        result.push({
          id: `binance-spot-${symbol}-${tradeIndex++}`,
          exchange: "Binance Spot",
          ticker: symbol,
          positionSize: parseFloat(matchedQty.toFixed(8)),
          tp: null,
          sl: null,
          openTime: new Date(lot.time).toISOString(),
          closeTime: new Date(fill.time).toISOString(),
          pnl: parseFloat(pnl.toFixed(4)),
          market: "spot" as const,
        })

        lot.qty -= matchedQty
        remainingSellQty -= matchedQty

        if (lot.qty < 1e-12) {
          buyQueue.shift()
        }
      }
    }
  }

  return result
}
