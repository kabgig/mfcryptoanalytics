import { buildFuturesAuth } from "./auth"

const BASE_URL = "https://contract.mexc.com"

export async function fetchBalance(apiKey: string, apiSecret: string): Promise<number> {
  const { headers, queryString } = await buildFuturesAuth(apiKey, apiSecret)
  const url = queryString
    ? `${BASE_URL}/api/v1/private/account/assets?${queryString}`
    : `${BASE_URL}/api/v1/private/account/assets`
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`MEXC balance ${res.status}: ${text}`)
  }
  const data = await res.json()
  if (!data.success) throw new Error(`MEXC balance API error ${data.code}`)
  const assets: Array<{ currency: string; equity: string }> = data.data ?? []
  const usdt = assets.find((a) => a.currency === "USDT")
  return usdt ? parseFloat(usdt.equity ?? "0") : 0
}
