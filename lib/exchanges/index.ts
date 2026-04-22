import { ExchangeAdapter } from "@/types"
import { MockAdapter } from "./adapters/mock"

// Add new exchange adapters here as you integrate them.
// e.g. new BinanceAdapter(), new BybitAdapter()
export const registry: ExchangeAdapter[] = [new MockAdapter()]
