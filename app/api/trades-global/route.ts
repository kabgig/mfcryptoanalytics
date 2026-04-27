import { handleTradesRequest } from "@/lib/api/tradesHandler"

export const dynamic = "force-dynamic"
export const preferredRegion = "iad1" // Washington DC — avoids EU geo-blocks on Binance/Bybit

export async function POST(request: Request) {
  return handleTradesRequest(request)
}
