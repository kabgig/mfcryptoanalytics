import { Trade } from "@/types"
import { buildOKXRequest } from "./auth"
import { OKXPositionsHistoryResponse, OKXPosition } from "./types"

const LIMIT = 100
const DELAY_MS = 200

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetches all closed futures/swap positions from OKX.
 * Uses GET /api/v5/account/positions-history — cursor-based pagination via posId.
 * Covers SWAP (perpetuals) and FUTURES (delivery) instruments.
 */
export async function fetchFuturesTrades(
  apiKey: string,
  apiSecret: string,
  passphrase: string
): Promise<Trade[]> {
  const allPositions: OKXPosition[] = []

  for (const instType of ["SWAP", "FUTURES"]) {
    let after = ""

    while (true) {
      const params: Record<string, string> = {
        instType,
        limit: String(LIMIT),
      }
      if (after) params.after = after

      const { url, headers } = await buildOKXRequest(
        "GET",
        "/api/v5/account/positions-history",
        params,
        apiKey,
        apiSecret,
        passphrase
      )

      const res = await fetch(url, { headers })

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`OKX positions-history error ${res.status}: ${body}`)
      }

      const data: OKXPositionsHistoryResponse = await res.json()

      if (data.code !== "0") {
        throw new Error(`OKX positions-history API error ${data.code}: ${data.msg}`)
      }

      const items = data.data ?? []
      allPositions.push(...items)

      if (items.length < LIMIT) break

      // Cursor: use posId of last record to get next page
      after = items[items.length - 1].posId
      await sleep(DELAY_MS)
    }
  }

  return allPositions
    .filter((p) => parseFloat(p.pnl) !== 0)
    .map((p) => ({
      id: `okx-futures-${p.posId}`,
      exchange: "OKX",
      // instId is "BTC-USDT-SWAP" or "BTC-USDT-231229" — strip the suffix
      ticker: p.instId.split("-").slice(0, 2).join(""),
      positionSize: parseFloat(p.openMaxPos) || 0,
      tp: null,
      sl: null,
      openTime: new Date(Number(p.cTime)).toISOString(),
      closeTime: new Date(Number(p.uTime)).toISOString(),
      pnl: parseFloat(p.pnl),
      market: "futures" as const,
    }))
}
