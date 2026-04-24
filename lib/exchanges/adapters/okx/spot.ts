import { Trade } from "@/types"
import { buildOKXRequest } from "./auth"
import { OKXFillsResponse, OKXFill } from "./types"
import { matchFifo, SpotFill } from "@/lib/exchanges/shared/fifo"

const LIMIT = 100
const DELAY_MS = 200

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetches all spot fills from OKX and computes PnL via FIFO matching.
 * Uses GET /api/v5/trade/fills-history?instType=SPOT — cursor pagination.
 */
export async function fetchSpotTrades(
  apiKey: string,
  apiSecret: string,
  passphrase: string
): Promise<Trade[]> {
  const allFills: OKXFill[] = []
  let after = ""

  while (true) {
    const params: Record<string, string> = {
      instType: "SPOT",
      limit: String(LIMIT),
    }
    if (after) params.after = after

    const { url, headers } = await buildOKXRequest(
      "GET",
      "/api/v5/trade/fills-history",
      params,
      apiKey,
      apiSecret,
      passphrase
    )

    const res = await fetch(url, { headers })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`OKX fills-history error ${res.status}: ${body}`)
    }

    const data: OKXFillsResponse = await res.json()

    if (data.code !== "0") {
      throw new Error(`OKX fills-history API error ${data.code}: ${data.msg}`)
    }

    const items = data.data ?? []
    allFills.push(...items)

    if (items.length < LIMIT) break

    after = items[items.length - 1].billId
    await sleep(DELAY_MS)
  }

  // Normalize to SpotFill and sort oldest-first for FIFO
  const fills: SpotFill[] = allFills
    .map((f) => {
      const isBuyer = f.side === "buy"
      const fee = parseFloat(f.fee) // OKX returns negative fee values
      return {
        id: f.billId,
        symbol: f.instId.replace(/-/g, ""), // "BTC-USDT" → "BTCUSDT"
        price: parseFloat(f.fillPx),
        qty: parseFloat(f.fillSz),
        isBuyer,
        time: Number(f.fillTime),
        commissionQty: Math.abs(fee),
        commissionAsset: f.feeCcy,
      }
    })
    .sort((a, b) => a.time - b.time)

  return matchFifo(fills, "OKX Spot", "okx-spot")
}
