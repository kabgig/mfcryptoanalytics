import { registry } from "@/lib/exchanges"

export const dynamic = "force-dynamic"
export const preferredRegion = "sin1" // Singapore — avoids Binance/Bybit US geo-blocks

export async function GET() {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      for (const adapter of registry) {
        try {
          const trades = await adapter.fetchTrades()
          controller.enqueue(
            encoder.encode(JSON.stringify({ exchange: adapter.name, trades }) + "\n")
          )
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ exchange: adapter.name, trades: [], error: String(err) }) + "\n"
            )
          )
        }
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  })
}
