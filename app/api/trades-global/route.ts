import { handleTradesRequest } from "@/lib/api/tradesHandler"

export const dynamic = "force-dynamic"
export const preferredRegion = "hkg1" // Hong Kong — Binance/Bybit accessible, avoids US/EU geo-blocks

export async function POST(request: Request) {
  return handleTradesRequest(request)
}
