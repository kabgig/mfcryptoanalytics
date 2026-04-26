import { buildOKXRequest } from "./auth"

export async function fetchBalance(
  apiKey: string,
  apiSecret: string,
  passphrase: string
): Promise<number> {
  const { url, headers } = await buildOKXRequest(
    "GET",
    "/api/v5/account/balance",
    {},
    apiKey,
    apiSecret,
    passphrase
  )
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OKX balance ${res.status}: ${text}`)
  }
  const data = await res.json()
  if (data.code !== "0") throw new Error(`OKX balance API error ${data.code}: ${data.msg}`)
  const details = data?.data?.[0]
  return details ? parseFloat(details.totalEq ?? "0") : 0
}
