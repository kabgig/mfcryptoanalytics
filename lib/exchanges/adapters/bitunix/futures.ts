import type { Trade } from "@/types"
import { buildAuthHeaders } from "./auth"
import type { BitunixPositionHistoryResponse, BitunixPositionRecord } from "./types"

const BASE_URL = "https://fapi.bitunix.com"
const LOOKBACK_DAYS = 180 // 6 months
const PAGE_SIZE = 100     // API maximum

/**
 * Maps one Bitunix position record to a Trade, or null when its timestamps are
 * unusable. Pure — exported for testing.
 *
 * The id uses `ctime` (open) rather than `mtime` (close). A position history
 * record is mutated in place as the position is closed down, so keying on
 * `mtime` turns each partial close into a brand-new id — stored as an extra
 * trade, with the stale snapshot left behind as a ghost. `ctime` is immutable,
 * so partial closes update the same row. See the OKX adapter, where this was
 * diagnosed against real data.
 *
 * `ctime`/`mtime` are typed `string | number`, so the id is built from the
 * parsed epoch ms rather than the raw field to keep it stable either way.
 */
export function positionToTrade(r: BitunixPositionRecord): Trade | null {
  const openDate = r.ctime ? new Date(Number(r.ctime)) : null
  const closeDate = r.mtime ? new Date(Number(r.mtime)) : null
  if (!openDate || isNaN(openDate.getTime()) || !closeDate || isNaN(closeDate.getTime())) return null

  return {
    id: `bitunix-futures-${r.positionId}-${openDate.getTime()}`,
    exchange: "Bitunix",
    ticker: r.symbol,
    positionSize: parseFloat(r.maxQty),
    tp: null,
    sl: null,
    openTime: openDate.toISOString(),
    closeTime: closeDate.toISOString(),
    pnl: parseFloat(r.realizedPNL),
    market: "futures" as const,
    side: r.side === "LONG" ? "long" : r.side === "SHORT" ? "short" : undefined,
  }
}

/**
 * Fetches all closed position records from Bitunix Futures
 * for the past 180 days, paginated via skip/limit.
 */
export async function fetchFuturesTrades(
  apiKey: string,
  apiSecret: string
): Promise<Trade[]> {
  const now = Date.now()
  const startTime = now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000

  const allTrades: Trade[] = []
  let skip = 0

  while (true) {
    const params: Record<string, string | number> = {
      startTime,
      endTime: now,
      skip,
      limit: PAGE_SIZE,
    }

    const { headers, urlQueryString } = await buildAuthHeaders(params, apiKey, apiSecret)

    const res = await fetch(
      `${BASE_URL}/api/v1/futures/position/get_history_positions?${urlQueryString}`,
      { headers }
    )

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Bitunix position history error ${res.status}: ${body}`)
    }

    const data: BitunixPositionHistoryResponse = await res.json()

    if (data.code !== 0) {
      throw new Error(`Bitunix API error ${data.code}: ${data.msg}`)
    }

    const { positionList, total } = data.data

    for (const r of positionList) {
      const trade = positionToTrade(r)
      if (trade) allTrades.push(trade)
    }

    skip += positionList.length
    if (skip >= total || positionList.length < PAGE_SIZE) break
  }

  return allTrades
}
