// ── Futures (positions-history) ───────────────────────────────────────────────
export interface OKXPosition {
  posId: string
  instId: string        // e.g. "BTC-USDT-SWAP"
  instType: string      // SWAP, FUTURES, etc.
  mgnMode: string
  openMaxPos: string    // max position size held
  openAvgPx: string     // average open price
  closeAvgPx: string    // average close price
  pnl: string           // realized PnL (can be negative)
  lever: string
  cTime: string         // open time ms (string)
  uTime: string         // close time ms (string)
}

export interface OKXPositionsHistoryResponse {
  code: string
  msg: string
  data: OKXPosition[]
}

// ── Spot (fills-history) ──────────────────────────────────────────────────────
export interface OKXFill {
  billId: string        // unique fill ID (used as cursor)
  instId: string        // e.g. "BTC-USDT"
  side: string          // "buy" | "sell"
  fillPx: string        // fill price
  fillSz: string        // fill size (base asset)
  fillTime: string      // time ms (string)
  fee: string           // fee amount (negative = expense)
  feeCcy: string        // fee currency
}

export interface OKXFillsResponse {
  code: string
  msg: string
  data: OKXFill[]
}
