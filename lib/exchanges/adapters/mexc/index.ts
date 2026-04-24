import { ExchangeAdapter, Trade } from "@/types"
import { fetchFuturesTrades } from "./futures"
import { fetchSpotTrades } from "./spot"

/**
 * MEXC exchange adapter.
 * Reads credentials and spot symbols from environment variables:
 *   MEXC_API_KEY      — required
 *   MEXC_API_SECRET   — required
 *   MEXC_SPOT_SYMBOLS — optional comma-separated list, e.g. "BTCUSDT,ETHUSDT"
 */
export class MEXCAdapter implements ExchangeAdapter {
  name = "MEXC"

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
