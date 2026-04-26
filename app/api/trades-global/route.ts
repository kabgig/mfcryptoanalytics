import { handleTradesRequest } from "@/lib/api/tradesHandler"

export const dynamic = "force-dynamic"
export const preferredRegion = "fra1" // Frankfurt — Binance/Bybit/OKX allow EU traffic

export async function POST(request: Request) {
  return handleTradesRequest(request)
}
