import { ExchangeAdapter, Trade } from "@/types"
import { fetchFuturesTrades } from "./futures"
import { fetchSpotTrades } from "./spot"

/**
 * OKX exchange adapter.
 * Reads credentials from environment variables:
 *   OKX_API_KEY      — required
 *   OKX_API_SECRET   — required
 *   OKX_PASSPHRASE   — required (set when creating the API key)
 *   OKX_SPOT         — set to "true" to also fetch spot fills (optional)
 */
export class OKXAdapter implements ExchangeAdapter {
  name = "OKX"

  private apiKey: string
  private apiSecret: string
  private passphrase: string
  private fetchSpot: boolean

  constructor(apiKey: string, apiSecret: string, passphrase: string, fetchSpot = false) {
    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.passphrase = passphrase
    this.fetchSpot = fetchSpot
  }

  async fetchTrades(_walletAddress?: string): Promise<Trade[]> {
    const [futuresTrades, spotTrades] = await Promise.all([
      fetchFuturesTrades(this.apiKey, this.apiSecret, this.passphrase),
      this.fetchSpot
        ? fetchSpotTrades(this.apiKey, this.apiSecret, this.passphrase)
        : Promise.resolve([] as Trade[]),
    ])

    return [...futuresTrades, ...spotTrades]
  }
}
