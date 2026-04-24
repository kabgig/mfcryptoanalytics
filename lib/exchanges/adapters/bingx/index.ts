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

  constructor(apiKey: string, apiSecret: string, spotSymbols: string[] = []) {
    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.spotSymbols = spotSymbols
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
