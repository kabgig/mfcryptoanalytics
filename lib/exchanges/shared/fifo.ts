import { Trade } from "@/types"

export interface SpotFill {
  id: string          // unique fill identifier
  symbol: string
  price: number
  qty: number         // base asset qty
  isBuyer: boolean
  time: number        // Unix ms
  commissionQty: number
  commissionAsset: string
}

interface BuyLot {
  qty: number
  price: number
  time: number
  commissionInQuote: number
}

/**
 * Shared FIFO cost-basis matching for spot fills.
 * Takes normalised SpotFill records and returns matched Trade objects.
 *
 * @param fills      Fills sorted oldest-first
 * @param exchange   Exchange label, e.g. "Binance Spot" or "Bybit Spot"
 * @param idPrefix   Prefix for generated trade IDs
 */
export function matchFifo(
  fills: SpotFill[],
  exchange: string,
  idPrefix: string
): Trade[] {
  const buyQueue: BuyLot[] = []
  const result: Trade[] = []
  let tradeIndex = 0

  for (const fill of fills) {
    const baseAsset = fill.symbol.replace(/USDT$|BTC$|ETH$|BNB$/, "")

    if (fill.isBuyer) {
      const commissionInQuote =
        fill.commissionAsset === baseAsset
          ? fill.commissionQty * fill.price  // paid in base — convert to quote
          : fill.commissionQty               // already in quote

      buyQueue.push({
        qty: fill.qty,
        price: fill.price,
        time: fill.time,
        commissionInQuote,
      })
    } else {
      let remainingSellQty = fill.qty
      const sellCommissionInQuote =
        fill.commissionAsset === "USDT"
          ? fill.commissionQty
          : fill.commissionQty * fill.price

      while (remainingSellQty > 1e-12 && buyQueue.length > 0) {
        const lot = buyQueue[0]
        const matchedQty = Math.min(lot.qty, remainingSellQty)
        const costBasis =
          lot.price * matchedQty +
          lot.commissionInQuote * (matchedQty / lot.qty)
        const proceeds =
          fill.price * matchedQty -
          sellCommissionInQuote * (matchedQty / fill.qty)
        const pnl = proceeds - costBasis

        result.push({
          id: `${idPrefix}-${fill.symbol}-${tradeIndex++}`,
          exchange,
          ticker: fill.symbol,
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
