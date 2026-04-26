import { ExchangeAdapter, Trade } from "@/types"
import { fetchFuturesTrades } from "./futures"

/**
 * BYDFi exchange adapter (Futures API).
 * Credentials: BYDFI_API_KEY, BYDFI_API_SECRET
 * Docs: https://developers.bydfi.com/en/futures/trade
 */
export class BYDFiAdapter implements ExchangeAdapter {
  name = "BYDFi"

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
