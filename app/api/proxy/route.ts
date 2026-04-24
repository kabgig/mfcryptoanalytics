import { BingXAdapter } from "@/lib/exchanges/adapters/bingx"
import { MEXCAdapter } from "@/lib/exchanges/adapters/mexc"

export const dynamic = "force-dynamic"
export const preferredRegion = "sin1" // Singapore — avoids geo-blocks (MEXC blocks VN, US)

/**
 * Thin server-side proxy for exchanges that don't support browser CORS.
 * Accepts POST { exchange, apiKey, apiSecret } — keys are never stored.
 */
export async function POST(request: Request) {
  let body: { exchange: string; apiKey: string; apiSecret: string }

  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { exchange, apiKey, apiSecret } = body

  if (!exchange || !apiKey || !apiSecret) {
    return Response.json({ error: "Missing exchange, apiKey or apiSecret" }, { status: 400 })
  }

  try {
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
