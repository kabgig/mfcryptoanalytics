// Bybit V5 – GET /v5/position/closed-pnl
export interface BybitClosedPnlRecord {
  symbol: string
  orderId: string
  side: string          // "Buy" | "Sell"
  qty: string           // order qty
  orderPrice: string
  orderType: string     // "Market" | "Limit"
  execType: string      // "Trade" | "BustTrade" | etc.
  closedSize: string    // closed position size
  cumEntryValue: string
  avgEntryPrice: string
  cumExitValue: string
  avgExitPrice: string
  closedPnl: string     // realized PnL (can be negative)
  fillCount: string
  leverage: string
  openFee: string
  closeFee: string
  createdTime: string   // ms timestamp string
  updatedTime: string   // ms timestamp string
}

export interface BybitClosedPnlResponse {
  retCode: number
  retMsg: string
  result: {
    nextPageCursor: string
    category: string
    list: BybitClosedPnlRecord[]
  }
}

// Bybit V5 – GET /v5/execution/list (spot fills)
export interface BybitSpotExecution {
  symbol: string
  orderId: string
  orderLinkId: string
  side: string          // "Buy" | "Sell"
  orderPrice: string
  orderQty: string
  execFee: string
  execId: string
  execPrice: string
  execQty: string
  execType: string
  execValue: string
  execTime: string      // ms timestamp string
  feeCurrency: string
  isMaker: boolean
  feeRate: string
}

export interface BybitExecutionResponse {
  retCode: number
  retMsg: string
  result: {
    nextPageCursor: string
    category: string
    list: BybitSpotExecution[]
  }
}
