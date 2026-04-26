import { handleTradesRequest } from "@/lib/api/tradesHandler"

export const dynamic = "force-dynamic"
export const preferredRegion = "sin1" // Singapore — required for BingX/MEXC

export async function POST(request: Request) {
  return handleTradesRequest(request)
}
