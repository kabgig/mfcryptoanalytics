import { ExchangeAdapter } from "@/types"
import { MockAdapter } from "./adapters/mock"
import { BinanceAdapter } from "./adapters/binance"
import { BybitAdapter } from "./adapters/bybit"
import { BingXAdapter } from "./adapters/bingx"
import { MEXCAdapter } from "./adapters/mexc"
import { OKXAdapter } from "./adapters/okx"

// Add new exchange adapters here as you integrate them.
const adapters: ExchangeAdapter[] = []

const hasBinance = process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET
const hasBybit = process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET
const hasBingX = process.env.BINGX_API_KEY && process.env.BINGX_API_SECRET
const hasMEXC = process.env.MEXC_API_KEY && process.env.MEXC_API_SECRET
const hasOKX = process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_PASSPHRASE

if (hasBinance) adapters.push(new BinanceAdapter(process.env.BINANCE_API_KEY!, process.env.BINANCE_API_SECRET!))
if (hasBybit) adapters.push(new BybitAdapter(process.env.BYBIT_API_KEY!, process.env.BYBIT_API_SECRET!))
if (hasBingX) adapters.push(new BingXAdapter(process.env.BINGX_API_KEY!, process.env.BINGX_API_SECRET!))
if (hasMEXC) adapters.push(new MEXCAdapter(process.env.MEXC_API_KEY!, process.env.MEXC_API_SECRET!))
if (hasOKX) adapters.push(new OKXAdapter(process.env.OKX_API_KEY!, process.env.OKX_API_SECRET!, process.env.OKX_PASSPHRASE!))

// Fall back to mock data when no real exchange credentials are configured
if (adapters.length === 0) adapters.push(new MockAdapter())

export const registry: ExchangeAdapter[] = adapters
