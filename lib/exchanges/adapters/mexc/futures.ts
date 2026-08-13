import type { Trade } from "@/types"
import { buildFuturesAuth } from "./auth"
import type { MEXCFuturesPositionPage, MEXCHistoryPosition } from "./types"

const BASE_URL = "https://contract.mexc.com"
const PAGE_SIZE = 100
const DELAY_MS = 200

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Maps one MEXC history position to a Trade. Pure — exported for testing.
 *
 * The id uses `createTime` (open) rather than `updateTime` (close). A position
 * history record is mutated in place as the position is closed down, so keying
 * on `updateTime` turns each partial close into a brand-new id — stored as an
 * extra trade, with the stale snapshot left behind as a ghost. `createTime` is
 * immutable, so partial closes update the same row. See the OKX adapter, where
 * this was diagnosed against real data.
 */
export function positionToTrade(p: MEXCHistoryPosition): Trade {
  return {
    id: `mexc-futures-${p.positionId}-${p.createTime}`,
    exchange: "MEXC",
    ticker: p.symbol.replace("_", ""),
    positionSize: parseFloat(p.openVol) || 0,
    tp: null,
    sl: null,
    openTime: new Date(p.createTime).toISOString(),
    closeTime: new Date(p.updateTime).toISOString(),
    pnl: parseFloat(p.realised),
    market: "futures" as const,
    side: p.holdSide === 1 ? "long" : "short",
  }
}

/**
 * Fetches all closed futures positions from MEXC.
 * Uses GET /api/v1/private/position/list/history_positions — paginated,
 * no time window constraint, returns all history.
 */
export async function fetchFuturesTrades(
  apiKey: string,
  apiSecret: string
): Promise<Trade[]> {
  const allPositions: MEXCHistoryPosition[] = []
  let pageNum = 1

  while (true) {
    const params = {
      page_num: String(pageNum),
      page_size: String(PAGE_SIZE),
    }

    const { headers, queryString } = await buildFuturesAuth(apiKey, apiSecret, params)

    const res = await fetch(
      `${BASE_URL}/api/v1/private/position/list/history_positions?${queryString}`,
      { headers }
    )

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`MEXC Futures history_positions error ${res.status}: ${body}`)
    }

    const data: MEXCFuturesPositionPage = await res.json()

    if (!data.success) {
      throw new Error(`MEXC Futures API error ${data.code}`)
    }

    const items = data.data?.resultList ?? []
    allPositions.push(...items)

    if (items.length < PAGE_SIZE) break
    pageNum++
    await sleep(DELAY_MS)
  }

  return allPositions
    .filter((p) => parseFloat(p.realised) !== 0)
    .map(positionToTrade)
}
