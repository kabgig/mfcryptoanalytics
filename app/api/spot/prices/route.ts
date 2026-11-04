import {
  getCachedDayRange,
  getEntries,
  getPriceHistory,
  insertPricesSkipExisting,
} from "@/lib/db/spot"
import { getLivePrices, upsertLivePrices, LIVE_PRICE_TTL_MS } from "@/lib/db/livePrices"
import { fetchCurrentPrices, fetchDailyCloses } from "@/lib/prices/spot"
import { computeBackfillGaps, firstTradeDay, tickersOf } from "@/lib/services/spotService"
import { requireUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

const toDay = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Daily close history plus live prices for everything a user holds.
 *
 * The backfill is deliberately incremental: for each ticker it asks the cache
 * for MAX(day) and fetches only from the day after that. A first visit pulls
 * the full history once; every later visit tops up a handful of days. Rewriting
 * whole histories would churn WAL and bloat the table, which is the actual
 * free-tier storage risk — not the row count.
 */
export async function GET() {
  const user = await requireUser()
  if (user instanceof Response) return user

  try {
    const entries = await getEntries(user.telegramId)
    const tickers = tickersOf(entries)
    const start = firstTradeDay(entries)

    if (tickers.length === 0 || !start) {
      return Response.json({ history: {}, current: {}, unpriced: [] })
    }

    const today = toDay(new Date())
    const cached = await getCachedDayRange(tickers)
    const unpriced: string[] = []

    for (const ticker of tickers) {
      // Each ticker's own history starts at its first trade, not the portfolio's —
      // fetching every coin from the portfolio's start would store rows for
      // periods the user did not hold it.
      const firstDay = firstTradeDay(entries.filter((e) => e.ticker === ticker)) ?? start
      const range = cached[ticker]
      const gaps = computeBackfillGaps(firstDay, range, today)

      let fetched = 0
      for (const [from, to] of gaps) {
        try {
          const points = await fetchDailyCloses(ticker, new Date(from), new Date(to))
          fetched += points.length
          await insertPricesSkipExisting(ticker, points)
        } catch (err) {
          // One dead ticker must not blank the whole page.
          console.error(`[spot/prices] backfill ${ticker} ${from}..${to} failed:`, err)
        }
      }

      // Only flag a ticker as unpriced when nothing is known about it at all.
      if (!range && fetched === 0) unpriced.push(ticker)
    }

    const history = await getPriceHistory(tickers, start)

    // Serve live prices from the shared cache; only refresh what is missing or
    // past the TTL. Concurrent requests within the TTL read the same rows and
    // make zero upstream calls — the global limiter the refresh button needs.
    const cachedLive = await getLivePrices(tickers)
    const nowMs = Date.now()
    const expired = tickers.filter(
      (t) => !(t in cachedLive) || nowMs - cachedLive[t].fetchedAt.getTime() >= LIVE_PRICE_TTL_MS
    )
    const current: Record<string, number> = {}
    if (expired.length > 0) {
      const fetched = await fetchCurrentPrices(expired)
      const rows = Object.entries(fetched).map(([ticker, price]) => ({ ticker, price }))
      try {
        await upsertLivePrices(rows)
      } catch (err) {
        // A cache write failure must not blank prices for this user.
        console.error("[spot/prices] live price cache write failed:", err)
      }
      Object.assign(current, fetched)
    }
    for (const t of tickers) {
      if (!(t in current) && t in cachedLive) current[t] = cachedLive[t].price
    }

    return Response.json({ history, current, unpriced })
  } catch (err) {
    console.error("[spot/prices] GET error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
