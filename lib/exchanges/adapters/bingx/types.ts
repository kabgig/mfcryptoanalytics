export interface BingXIncomeRecord {
  symbol: string
  incomeType: string      // REALIZED_PNL, FUNDING_FEE, etc.
  income: string          // signed PnL amount
  asset: string           // USDT
  time: number            // Unix ms
  info: string
  tranId: string
  tradeId: string
}

export interface BingXIncomeResponse {
  code: number
  msg: string
  data: BingXIncomeRecord[]
}

export interface BingXSpotOrder {
  orderId: string
  symbol: string
  side: string            // BUY | SELL
  price: string
  origQty: string
  executedQty: string
  cummulativeQuoteQty: string
  status: string
  time: number            // Unix ms
  updateTime: number
}

export interface BingXSpotOrderResponse {
  code: number
  msg: string
  data: {
    orders: BingXSpotOrder[]
    total: number
  }
}

export interface BingXSpotFill {
  tradeId: string
  orderId: string
  symbol: string
  side: string            // BUY | SELL
  price: string
  qty: string
  quoteQty: string
  commission: string
  commissionAsset: string
  time: number
}

export interface BingXSpotFillResponse {
  code: number
  msg: string
  data: {
    fills: BingXSpotFill[]
    total: number
  }
}
