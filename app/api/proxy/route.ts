import { BingXAdapter } from "@/lib/exchanges/adapters/bingx"
import { MEXCAdapter } from "@/lib/exchanges/adapters/mexc"
import { fetchBalance as fetchBingXBalance } from "@/lib/exchanges/adapters/bingx/balance"
import { fetchBalance as fetchMEXCBalance } from "@/lib/exchanges/adapters/mexc/balance"

export const dynamic = "force-dynamic"
export const preferredRegion = "sin1" // Singapore — avoids geo-blocks (MEXC blocks VN, US)

/**
 * Thin server-side proxy for exchanges that don't support browser CORS.
 * Accepts POST { action?, exchange, apiKey, apiSecret }
 * action "trades" (default) — returns { trades }
 * action "balance"          — returns { balance }
 * Keys are never stored.
 */
export async function POST(request: Request) {
  let body: { action?: string; exchange: string; apiKey: string; apiSecret: string }

  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { action = "trades", exchange, apiKey, apiSecret } = body

  if (!exchange || !apiKey || !apiSecret) {
    return Response.json({ error: "Missing exchange, apiKey or apiSecret" }, { status: 400 })
  }

  try {
    if (action === "balance") {
      let balance: number

      if (exchange === "BingX") {
        balance = await fetchBingXBalance(apiKey, apiSecret)
      } else if (exchange === "MEXC") {
        balance = await fetchMEXCBalance(apiKey, apiSecret)
      } else {
        return Response.json({ error: `Unknown exchange: ${exchange}` }, { status: 400 })
      }

      return Response.json({ balance })
    }

    let trades

    if (exchange === "BingX") {
      trades = await new BingXAdapter(apiKey, apiSecret).fetchTrades()
    } else if (exchange === "MEXC") {
      trades = await new MEXCAdapter(apiKey, apiSecret).fetchTrades()
    } else {
      return Response.json({ error: `Unknown exchange: ${exchange}` }, { status: 400 })
    }

    return Response.json({ trades })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 })
  }
}
