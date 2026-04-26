import { buildAuthHeaders } from "./auth"

const BASE_URL = "https://api.bybit.com"

export async function fetchBalance(apiKey: string, apiSecret: string): Promise<number> {
  const queryString = "accountType=UNIFIED"
  const headers = await buildAuthHeaders(queryString, apiKey, apiSecret)
  const res = await fetch(`${BASE_URL}/v5/account/wallet-balance?${queryString}`, { headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Bybit balance ${res.status}: ${text}`)
  }
  const data = await res.json()
  if (data.retCode !== 0) throw new Error(`Bybit balance API error ${data.retCode}: ${data.retMsg}`)
  const account = data?.result?.list?.[0]
  return account ? parseFloat(account.totalEquity ?? "0") : 0
}
