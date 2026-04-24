import { ExchangeAdapter, Trade } from "@/types"
import { fetchFuturesTrades } from "./futures"
import { fetchSpotTrades } from "./spot"

/**
 * BingX exchange adapter (Open API v1).
 * Reads credentials and spot symbols from environment variables:
 *   BINGX_API_KEY      — required
 *   BINGX_API_SECRET   — required
 *   BINGX_SPOT_SYMBOLS — optional comma-separated list, e.g. "BTC-USDT,ETH-USDT"
 */
export class BingXAdapter implements ExchangeAdapter {
  name = "BingX"

  private apiKey: string
  private apiSecret: string
  private spotSymbols: string[]

  constructor() {
    const apiKey = process.env.BINGX_API_KEY
    const apiSecret = process.env.BINGX_API_SECRET

    if (!apiKey || !apiSecret) {
      throw new Error(
        "BingXAdapter requires BINGX_API_KEY and BINGX_API_SECRET env vars."
      )
    }

    this.apiKey = apiKey
    this.apiSecret = apiSecret

    const symbolsEnv = process.env.BINGX_SPOT_SYMBOLS ?? ""
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
