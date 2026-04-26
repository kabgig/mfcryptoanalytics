import { fetchBalance as fetchBingXBalance } from "@/lib/exchanges/adapters/bingx/balance"
import { fetchBalance as fetchMEXCBalance } from "@/lib/exchanges/adapters/mexc/balance"

export const dynamic = "force-dynamic"
export const preferredRegion = "sin1"

interface BalanceRequestBody {
  exchange: string
  apiKey: string
  apiSecret: string
}

export async function POST(request: Request) {
  let body: BalanceRequestBody

  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { exchange, apiKey, apiSecret } = body

  if (!exchange || !apiKey || !apiSecret) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  try {
    let balance: number
    switch (exchange) {
      case "BingX": balance = await fetchBingXBalance(apiKey, apiSecret); break
      case "MEXC":  balance = await fetchMEXCBalance(apiKey, apiSecret); break
      default:      return Response.json({ error: `Unknown exchange: ${exchange}` }, { status: 400 })
    }
    return Response.json({ balance })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 })
  }
}
