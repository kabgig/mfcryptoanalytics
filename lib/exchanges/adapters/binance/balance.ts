import { signParams } from "./auth"

const FUTURES_BASE_URL = "https://fapi.binance.com"

export async function fetchBalance(apiKey: string, apiSecret: string): Promise<number> {
  const params = await signParams({}, apiSecret)
  const res = await fetch(`${FUTURES_BASE_URL}/fapi/v3/balance?${params}`, {
    headers: { "X-MBX-APIKEY": apiKey },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Binance balance ${res.status}: ${text}`)
  }
  const data: Array<{ asset: string; balance: string }> = await res.json()
  const usdt = data.find((a) => a.asset === "USDT")
  return usdt ? parseFloat(usdt.balance) : 0
}
