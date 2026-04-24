// ── Spot (v3) ─────────────────────────────────────────────────────────────────
export interface MEXCSpotTrade {
  symbol: string
  id: number
  orderId: string
  price: string
  qty: string
  quoteQty: string
  commission: string
  commissionAsset: string
  time: number
  isBuyer: boolean
  isMaker: boolean
  isBestMatch: boolean
}

// ── Futures (v1) ──────────────────────────────────────────────────────────────
export interface MEXCHistoryPosition {
  symbol: string
  positionId: string
  holdSide: number        // 1 = long, 2 = short
  openVol: string         // position size at open
  closeVol: string
  openAvgPrice: string
  closeAvgPrice: string
  realised: string        // realized PnL (can be negative)
  createTime: number      // open time ms
  updateTime: number      // close time ms
}

export interface MEXCFuturesPositionPage {
  success: boolean
  code: number
  data: {
    pageSize: number
    totalPage: number
    totalCount: number
    resultList: MEXCHistoryPosition[]
  }
}
