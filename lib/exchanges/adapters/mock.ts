import { ExchangeAdapter, Trade } from "@/types"
import { generateDummyTrades } from "@/lib/data/dummy"

export class MockAdapter implements ExchangeAdapter {
  name = "Mock"

  async fetchTrades(_walletAddress?: string): Promise<Trade[]> {
    // Returns pre-generated dummy trades.
    // Replace this implementation with a real API call when ready.
    return generateDummyTrades()
  }
}
