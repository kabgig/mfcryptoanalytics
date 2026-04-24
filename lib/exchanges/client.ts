import { ExchangeAdapter } from "@/types"
import { BinanceAdapter } from "./adapters/binance"
import { BybitAdapter } from "./adapters/bybit"
import { BingXAdapter } from "./adapters/bingx"
import { MEXCAdapter } from "./adapters/mexc"
import { OKXAdapter } from "./adapters/okx"

export interface ClientApiKeys {
  binanceApiKey: string
  binanceApiSecret: string
  bybitApiKey: string
  bybitApiSecret: string
  bingxApiKey: string
  bingxApiSecret: string
  mexcApiKey: string
  mexcApiSecret: string
  okxApiKey: string
  okxApiSecret: string
  okxPassphrase: string
}

/** Builds an exchange adapter registry from keys stored client-side (e.g. localStorage). */
export function buildClientRegistry(keys: ClientApiKeys): ExchangeAdapter[] {
  const adapters: ExchangeAdapter[] = []

  if (keys.binanceApiKey && keys.binanceApiSecret)
    adapters.push(new BinanceAdapter(keys.binanceApiKey, keys.binanceApiSecret))

  if (keys.bybitApiKey && keys.bybitApiSecret)
    adapters.push(new BybitAdapter(keys.bybitApiKey, keys.bybitApiSecret))

  if (keys.bingxApiKey && keys.bingxApiSecret)
    adapters.push(new BingXAdapter(keys.bingxApiKey, keys.bingxApiSecret))

  if (keys.mexcApiKey && keys.mexcApiSecret)
    adapters.push(new MEXCAdapter(keys.mexcApiKey, keys.mexcApiSecret))

  if (keys.okxApiKey && keys.okxApiSecret && keys.okxPassphrase)
    adapters.push(new OKXAdapter(keys.okxApiKey, keys.okxApiSecret, keys.okxPassphrase))

  return adapters
}
