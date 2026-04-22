import { NextRequest, NextResponse } from "next/server"
import { getAllTrades } from "@/lib/services/tradesService"

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const address = searchParams.get("address") ?? undefined

  const trades = await getAllTrades(address)
  return NextResponse.json(trades)
}
