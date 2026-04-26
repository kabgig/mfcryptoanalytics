import type { ClientApiKeys } from "@/lib/exchanges/client"
import { fetchBalance as fetchBinanceBalance } from "@/lib/exchanges/adapters/binance/balance"
import { fetchBalance as fetchBybitBalance } from "@/lib/exchanges/adapters/bybit/balance"
import { fetchBalance as fetchOKXBalance } from "@/lib/exchanges/adapters/okx/balance"

export interface ExchangeBalance {
  exchange: string
  balance: number
}

export interface BalanceResult {
  total: number
  exchanges: ExchangeBalance[]
  errors: Record<string, string>
}

async function fetchViaBalanceRoute(exchange: string, apiKey: string, apiSecret: string): Promise<number> {
  const res = await fetch("/api/balance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exchange, apiKey, apiSecret }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data.balance as number
}

export async function fetchAllBalances(keys: ClientApiKeys): Promise<BalanceResult> {
  const tasks: Array<{ name: string; fn: () => Promise<number> }> = []

  if (keys.binanceApiKey && keys.binanceApiSecret)
    tasks.push({ name: "Binance", fn: () => fetchBinanceBalance(keys.binanceApiKey, keys.binanceApiSecret) })

  if (keys.bybitApiKey && keys.bybitApiSecret)
    tasks.push({ name: "Bybit", fn: () => fetchBybitBalance(keys.bybitApiKey, keys.bybitApiSecret) })

  if (keys.okxApiKey && keys.okxApiSecret && keys.okxPassphrase)
    tasks.push({ name: "OKX", fn: () => fetchOKXBalance(keys.okxApiKey, keys.okxApiSecret, keys.okxPassphrase) })

  if (keys.bingxApiKey && keys.bingxApiSecret)
    tasks.push({ name: "BingX", fn: () => fetchViaBalanceRoute("BingX", keys.bingxApiKey, keys.bingxApiSecret) })

  if (keys.mexcApiKey && keys.mexcApiSecret)
    tasks.push({ name: "MEXC", fn: () => fetchViaBalanceRoute("MEXC", keys.mexcApiKey, keys.mexcApiSecret) })

  const results = await Promise.allSettled(tasks.map((t) => t.fn()))

  const exchanges: ExchangeBalance[] = []
  const errors: Record<string, string> = {}

  results.forEach((result, i) => {
    const name = tasks[i].name
    if (result.status === "fulfilled") {
      exchanges.push({ exchange: name, balance: result.value })
    } else {
      errors[name] = String(result.reason)
    }
  })

  const total = exchanges.reduce((sum, e) => sum + e.balance, 0)

  return { total, exchanges, errors }
}
