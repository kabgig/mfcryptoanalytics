import type { Trade } from "@/types"
import { buildOKXRequest } from "./auth"
import type { OKXPositionsHistoryResponse, OKXPosition } from "./types"

const LIMIT = 100
const DELAY_MS = 200
/** Safety cap per instType — 2,000 positions in OKX's 3-month window. */
const MAX_PAGES = 20

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Maps one OKX positions-history record to a Trade. Pure — exported for testing.
 *
 * The id is `posId` + `cTime` (the position's OPEN time), and the choice of
 * timestamp matters in both directions:
 *
 * - `posId` alone is not enough. OKX recycles it: one posId legitimately covered
 *   18 separate positions on a single instrument over three months.
 * - `uTime` (the close/update time) is wrong, even though it looks like the
 *   natural discriminator. OKX does not append a record when you close part of a
 *   position — it edits the existing one in place, accumulating `pnl` and
 *   advancing `uTime`. Keyed on `uTime`, the same position gets a new id after
 *   every partial close, so it is stored as an extra trade instead of updating
 *   the existing row. Nothing prunes cached rows whose id vanished from the
 *   exchange response, so the intermediate snapshot survives forever as a ghost
 *   trade inflating the user's stats.
 *
 * `cTime` is immutable for a position instance and distinct across recycled
 * posIds, so partial closes now update one row (pnl 21.90 → 44.75) instead of
 * spawning a second one.
 */
export function positionToTrade(p: OKXPosition): Trade {
  return {
    id: `okx-futures-${p.posId}-${p.cTime}`,
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
  }
}

/**
 * Fetches all closed futures/swap positions from OKX.
 * Uses GET /api/v5/account/positions-history, newest first.
 * Covers SWAP (perpetuals) and FUTURES (delivery) instruments.
 *
 * Pagination: `after` is a **uTime** in ms ("records earlier than"), not a posId.
 * It used to be passed the last posId — a ~4.5e17 number that OKX reads as a
 * date far in the future, so it re-served the first page forever. That was
 * invisible until an account first held 100+ positions in the window; from then
 * on every sync failed and the dashboard froze on its last stored trades.
 */
export async function fetchFuturesTrades(
  apiKey: string,
  apiSecret: string,
  passphrase: string
): Promise<Trade[]> {
  const allPositions: OKXPosition[] = []

  for (const instType of ["SWAP", "FUTURES"]) {
    let after = ""

    for (let page = 1; ; page++) {
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

      // Cursor: the oldest uTime on this page. OKX returns every record sharing
      // a uTime in one page, so "earlier than" neither skips nor repeats any.
      const next = Math.min(...items.map((p) => Number(p.uTime)))
      // A cursor that does not move backwards would refetch the same page forever.
      if (!Number.isFinite(next) || (after && next >= Number(after))) {
        console.warn(`[okx] ${instType} pagination stalled at uTime=${after}; stopping`)
        break
      }
      if (page >= MAX_PAGES) {
        console.warn(`[okx] ${instType} hit ${MAX_PAGES}-page cap; older positions skipped`)
        break
      }
      after = String(next)
      await sleep(DELAY_MS)
    }
  }

  // Ids are unique per position, so a repeat can only be a re-served page.
  const seen = new Set<string>()
  return allPositions
    .filter((p) => parseFloat(p.pnl) !== 0)
    .map(positionToTrade)
    .filter((t) => !seen.has(t.id) && seen.add(t.id))
}
