import { ExchangeAdapter, Trade } from "@/types"
import { fetchFuturesTrades } from "./futures"

/**
 * Bitunix exchange adapter (Futures API).
 * Credentials: BITUNIX_API_KEY, BITUNIX_API_SECRET
 * Docs: https://www.bitunix.com/api-docs/futures/common/introduction.html
 */
export class BitunixAdapter implements ExchangeAdapter {
  name = "Bitunix"

  private apiKey: string
  private apiSecret: string

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey
    this.apiSecret = apiSecret
  }

  async fetchTrades(): Promise<Trade[]> {
    return fetchFuturesTrades(this.apiKey, this.apiSecret)
  }
}
