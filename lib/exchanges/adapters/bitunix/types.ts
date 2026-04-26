// Bitunix – GET /api/v1/futures/position/get_history_positions
export interface BitunixPositionRecord {
  positionId: string
  symbol: string
  maxQty: string       // max position size during trade
  entryPrice: string   // average entry price
  closePrice: string   // average close price
  side: string         // "LONG" | "SHORT"
  marginMode: string   // "ISOLATION" | "CROSS"
  positionMode: string // "ONE_WAY" | "HEDGE"
  leverage: number
  fee: string          // transaction fees
  funding: string      // funding fees
  realizedPNL: string  // realized PnL (excluding funding and fee)
  liqPrice: string
  ctime: string | number  // position open timestamp ms (API returns as string)
  mtime: string | number  // position close timestamp ms (API returns as string)
}

export interface BitunixPositionHistoryResponse {
  code: number
  msg: string
  data: {
    positionList: BitunixPositionRecord[]
    total: number
  }
}
