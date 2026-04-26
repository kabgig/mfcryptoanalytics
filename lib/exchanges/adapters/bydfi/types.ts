// BYDFi – GET /v1/fapi/trade/position_history
export interface BYDFiPositionRecord {
  id: number
  wallet: string
  symbol: string           // e.g. "BTC-USDT"
  currency: string
  side: string             // "BUY" | "SELL"
  positionSide: string     // "BOTH" | "LONG" | "SHORT"
  leverage: number
  avgOpenPositionPrice: string
  openPositionVolume: number
  openCount: number
  avgClosePositionPrice: string
  closePositionVolume: number
  positionProfits: string  // net position PnL
  openFeeTotal: string
  closeFeeTotal: string
  capitalFeeTotal: string
  liqClosed: boolean
  liqLoss: string
  createTime: number       // closing timestamp ms  (per API docs)
  updateTime: number       // opening timestamp ms  (per API docs)
}
