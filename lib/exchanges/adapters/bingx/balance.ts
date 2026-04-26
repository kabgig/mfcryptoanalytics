import { buildSignedQuery } from "./auth"

const BASE_URL = "https://open-api.bingx.com"

export async function fetchBalance(apiKey: string, apiSecret: string): Promise<number> {
  const query = await buildSignedQuery({}, apiSecret)
  const res = await fetch(`${BASE_URL}/openApi/swap/v3/user/balance?${query}`, {
    headers: { "X-BX-APIKEY": apiKey },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`BingX balance ${res.status}: ${text}`)
  }
  const data = await res.json()
  if (data.code !== 0) throw new Error(`BingX balance API error ${data.code}: ${data.msg}`)
  return parseFloat(data?.data?.balance?.equity ?? "0")
}
