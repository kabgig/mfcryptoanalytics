export interface Trade {
  id: string
  exchange: string
  ticker: string
  positionSize: number
  tp: number | null
  sl: number | null
  openTime: string  // ISO string
  closeTime: string // ISO string
  pnl: number
  market?: "spot" | "futures"
}

export interface ExchangeAdapter {
  name: string
  fetchTrades(walletAddress?: string): Promise<Trade[]>
}

export interface WalletUser {
  address: string // sole identity — no email/password
}

export interface StatsResult {
  totalPnl: number
  winRate: number
  tradeCount: number
  chartData: { date: string; cumulativePnl: number }[]
}
