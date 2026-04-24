import { ExchangeAdapter } from "@/types"
import { MockAdapter } from "./adapters/mock"
import { BinanceAdapter } from "./adapters/binance"
import { BybitAdapter } from "./adapters/bybit"
import { BingXAdapter } from "./adapters/bingx"

// Add new exchange adapters here as you integrate them.
const adapters: ExchangeAdapter[] = []

const hasBinance = process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET
const hasBybit = process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET
const hasBingX = process.env.BINGX_API_KEY && process.env.BINGX_API_SECRET

if (hasBinance) adapters.push(new BinanceAdapter())
if (hasBybit) adapters.push(new BybitAdapter())
if (hasBingX) adapters.push(new BingXAdapter())

// Fall back to mock data when no real exchange credentials are configured
if (adapters.length === 0) adapters.push(new MockAdapter())

export const registry: ExchangeAdapter[] = adapters
