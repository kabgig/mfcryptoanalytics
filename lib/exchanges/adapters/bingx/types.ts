export interface BingXPositionRecord {
  positionId: string
  symbol: string
  currency: string
  positionAmt: string     // position size (base asset)
  realisedPnl: string     // realised PnL in quote
  openPrice: string
  closePrice: string
  openTime: number        // Unix ms
  closeTime: number       // Unix ms
  positionSide: string    // LONG | SHORT
  leverage: string
}

export interface BingXPositionHistoryResponse {
  code: number
  msg: string
  data: {
    positionHistoryVoList: BingXPositionRecord[]
    total: number
  }
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
