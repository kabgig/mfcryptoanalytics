// Binance Futures USDM – GET /fapi/v1/income
export interface BinanceFuturesIncomeRecord {
  symbol: string       // e.g. "BTCUSDT", "" for non-trade income
  incomeType: string   // "REALIZED_PNL" | "FUNDING_FEE" | "COMMISSION" | …
  income: string       // numeric string, can be negative
  asset: string        // e.g. "USDT"
  info: string
  time: number         // Unix ms
  tranId: string
  tradeId: string
}

// Binance Spot – GET /api/v3/myTrades
export interface BinanceSpotTrade {
  symbol: string          // e.g. "BTCUSDT"
  id: number
  orderId: number
  orderListId: number
  price: string           // numeric string
  qty: string             // base asset quantity
  quoteQty: string        // quote asset quantity (price × qty)
  commission: string      // numeric string
  commissionAsset: string // e.g. "BNB", "USDT"
  time: number            // Unix ms
  isBuyer: boolean
  isMaker: boolean
  isBestMatch: boolean
}
