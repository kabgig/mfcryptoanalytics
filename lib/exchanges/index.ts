import { ExchangeAdapter } from "@/types"
import { MockAdapter } from "./adapters/mock"
import { BinanceAdapter } from "./adapters/binance"

// Add new exchange adapters here as you integrate them.
// e.g. new BybitAdapter()
const adapters: ExchangeAdapter[] = []

// Use MockAdapter as fallback when no real exchange credentials are configured
if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
  adapters.push(new BinanceAdapter())
} else {
  adapters.push(new MockAdapter())
}

export const registry: ExchangeAdapter[] = adapters
