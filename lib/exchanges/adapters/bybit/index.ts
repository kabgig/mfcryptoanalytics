import { ExchangeAdapter, Trade } from "@/types"
import { fetchFuturesTrades } from "./futures"
import { fetchSpotTrades } from "./spot"

/**
 * Bybit exchange adapter (V5 API).
 * Reads credentials and spot symbols from environment variables:
 *   BYBIT_API_KEY      — required
 *   BYBIT_API_SECRET   — required
 *   BYBIT_SPOT_SYMBOLS — optional comma-separated list, e.g. "BTCUSDT,ETHUSDT"
 */
export class BybitAdapter implements ExchangeAdapter {
  name = "Bybit"

  private apiKey: string
  private apiSecret: string
  private spotSymbols: string[]

  constructor() {
    const apiKey = process.env.BYBIT_API_KEY
    const apiSecret = process.env.BYBIT_API_SECRET

    if (!apiKey || !apiSecret) {
      throw new Error(
        "BybitAdapter requires BYBIT_API_KEY and BYBIT_API_SECRET env vars."
      )
    }

    this.apiKey = apiKey
    this.apiSecret = apiSecret

    const symbolsEnv = process.env.BYBIT_SPOT_SYMBOLS ?? ""
    this.spotSymbols = symbolsEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }

  async fetchTrades(_walletAddress?: string): Promise<Trade[]> {
    const [futuresTrades, spotTrades] = await Promise.all([
      fetchFuturesTrades(this.apiKey, this.apiSecret),
      this.spotSymbols.length > 0
        ? fetchSpotTrades(this.apiKey, this.apiSecret, this.spotSymbols)
        : Promise.resolve([] as Trade[]),
    ])

    return [...futuresTrades, ...spotTrades]
  }
}
