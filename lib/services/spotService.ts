import type {
  AllocationSlice,
  DcaPoint,
  PortfolioPoint,
  SpotEntry,
  SpotHolding,
} from "@/types/spot"

/**
 * Quantity below which a position counts as fully closed.
 *
 * Selling "everything" rarely lands on exactly 0 once the amounts have been
 * through float arithmetic, and a leftover 1e-17 would keep a dead position
 * alive with a meaningless average entry. Anything under this is treated as
 * flat, which is what triggers the cost-basis reset.
 */
export const DUST = 1e-8

/** Pure functions only — no I/O — so every rule below is unit-testable. */

function sortEntries(entries: SpotEntry[]): SpotEntry[] {
  return [...entries].sort((a, b) => {
    const t = a.tradedAt.localeCompare(b.tradedAt)
    return t !== 0 ? t : a.id.localeCompare(b.id)
  })
}

export function tickersOf(entries: SpotEntry[]): string[] {
  return [...new Set(entries.map((e) => e.ticker))].sort()
}

/** Earliest trade date across all entries as YYYY-MM-DD, or null when empty. */
export function firstTradeDay(entries: SpotEntry[]): string | null {
  if (entries.length === 0) return null
  return sortEntries(entries)[0].tradedAt.slice(0, 10)
}

/**
 * Replays one ticker's entries in trade order under average-cost accounting.
 *
 * A BUY adds units and cost. A SELL removes units and retires cost at the
 * *current average*, so the average entry of the remaining units is unchanged —
 * that is what makes the average meaningful for a DCA position.
 *
 * When a sell takes the position flat (within DUST) the cost basis resets to
 * zero, closing the DCA cycle. A later re-buy therefore starts a fresh average
 * instead of being blended with a position that no longer exists.
 */
export function computeHolding(
  ticker: string,
  entries: SpotEntry[],
  currentPrice: number | null
): SpotHolding {
  let qty = 0
  let costBasis = 0
  let realisedPnl = 0
  let totalInvested = 0
  let buyCount = 0
  let sellCount = 0

  for (const e of sortEntries(entries)) {
    if (e.side === "BUY") {
      qty += e.qty
      costBasis += e.qty * e.price
      totalInvested += e.qty * e.price
      buyCount += 1
      continue
    }

    // SELL — never let a bad row drive qty negative.
    const sold = Math.min(e.qty, qty)
    if (sold <= 0) continue
    const avgAtSale = qty > 0 ? costBasis / qty : 0
    realisedPnl += sold * (e.price - avgAtSale)
    qty -= sold
    costBasis -= sold * avgAtSale
    sellCount += 1

    // Position fully closed: reset the cycle so the next buy starts clean.
    if (qty <= DUST) {
      qty = 0
      costBasis = 0
    }
  }

  const avgEntry = qty > DUST ? costBasis / qty : null
  const marketValue = currentPrice != null ? qty * currentPrice : null
  const unrealisedPnl = marketValue != null ? marketValue - costBasis : null
  const unrealisedPct =
    unrealisedPnl != null && costBasis > 0 ? (unrealisedPnl / costBasis) * 100 : null

  return {
    ticker,
    qty,
    costBasis,
    avgEntry,
    currentPrice,
    marketValue,
    unrealisedPnl,
    unrealisedPct,
    realisedPnl,
    totalInvested,
    buyCount,
    sellCount,
  }
}

/** One holding per ticker, largest market value (then cost basis) first. */
export function computeHoldings(
  entries: SpotEntry[],
  prices: Record<string, number>
): SpotHolding[] {
  const byTicker = new Map<string, SpotEntry[]>()
  for (const e of entries) {
    const list = byTicker.get(e.ticker)
    if (list) list.push(e)
    else byTicker.set(e.ticker, [e])
  }

  return [...byTicker.entries()]
    .map(([ticker, list]) => computeHolding(ticker, list, prices[ticker] ?? null))
    .sort((a, b) => (b.marketValue ?? b.costBasis) - (a.marketValue ?? a.costBasis))
}

/** Whole-portfolio totals. Unpriced tickers contribute cost but not value. */
export function computeTotals(holdings: SpotHolding[]) {
  const costBasis = holdings.reduce((s, h) => s + h.costBasis, 0)
  const marketValue = holdings.reduce((s, h) => s + (h.marketValue ?? 0), 0)
  const realisedPnl = holdings.reduce((s, h) => s + h.realisedPnl, 0)
  const totalInvested = holdings.reduce((s, h) => s + h.totalInvested, 0)
  const unrealisedPnl = marketValue - costBasis
  return {
    costBasis,
    marketValue,
    realisedPnl,
    totalInvested,
    unrealisedPnl,
    unrealisedPct: costBasis > 0 ? (unrealisedPnl / costBasis) * 100 : null,
    openTickers: holdings.filter((h) => h.qty > DUST).length,
  }
}

/** Shifts a YYYY-MM-DD day by whole days. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The day ranges still missing from the price cache for one ticker.
 *
 * Returns the older gap (an entry backdated before anything cached), the newer
 * gap (days since the last visit), or the whole span when nothing is cached.
 * The cached middle is never re-fetched, which is what keeps writes append-only.
 *
 * Resuming only forward from the newest cached day was a real bug: once the
 * cache reached today, backdating an entry fetched nothing and the chart had no
 * market line before the cached window.
 */
export function computeBackfillGaps(
  firstDay: string,
  cached: { min: string; max: string } | undefined,
  today: string
): [string, string][] {
  if (!cached) return firstDay <= today ? [[firstDay, today]] : []

  const gaps: [string, string][] = []
  if (firstDay < cached.min) gaps.push([firstDay, shiftDay(cached.min, -1)])
  if (cached.max < today) gaps.push([shiftDay(cached.max, 1), today])
  return gaps.filter(([from, to]) => from <= to)
}

/** Inclusive list of YYYY-MM-DD days from `start` to `end`. */
export function dayRange(start: string, end: string): string[] {
  const out: string[] = []
  const cur = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

/**
 * Forward-fills a sparse daily series so weekends/gaps inherit the last close.
 * Days before the first known close stay null — we do not invent history.
 */
function fillForward(
  days: string[],
  points: { day: string; close: number }[]
): Map<string, number | null> {
  const known = new Map(points.map((p) => [p.day, p.close]))
  const out = new Map<string, number | null>()
  let last: number | null = null
  for (const d of days) {
    const v = known.get(d)
    if (v != null) last = v
    out.set(d, last)
  }
  return out
}

/**
 * Daily DCA line for one ticker: running average entry against market price.
 *
 * `avgEntry` is null on days nothing is held. Recharts breaks a line on null,
 * so a fully-sold-then-rebought position renders as two separate segments
 * rather than one line sloping through a period the user held nothing.
 */
export function buildDcaSeries(
  ticker: string,
  entries: SpotEntry[],
  pricePoints: { day: string; close: number }[],
  today: string
): DcaPoint[] {
  const own = sortEntries(entries.filter((e) => e.ticker === ticker))
  if (own.length === 0) return []

  const start = own[0].tradedAt.slice(0, 10)
  const days = dayRange(start, today)
  const market = fillForward(days, pricePoints)

  const byDay = new Map<string, SpotEntry[]>()
  for (const e of own) {
    const d = e.tradedAt.slice(0, 10)
    const list = byDay.get(d)
    if (list) list.push(e)
    else byDay.set(d, [e])
  }

  let qty = 0
  let costBasis = 0
  const out: DcaPoint[] = []

  for (const day of days) {
    let buyPrice: number | undefined
    let sellPrice: number | undefined

    for (const e of byDay.get(day) ?? []) {
      if (e.side === "BUY") {
        qty += e.qty
        costBasis += e.qty * e.price
        buyPrice = e.price
      } else {
        const sold = Math.min(e.qty, qty)
        if (sold <= 0) continue
        const avgAtSale = qty > 0 ? costBasis / qty : 0
        qty -= sold
        costBasis -= sold * avgAtSale
        sellPrice = e.price
        if (qty <= DUST) {
          qty = 0
          costBasis = 0
        }
      }
    }

    out.push({
      date: day,
      avgEntry: qty > DUST ? costBasis / qty : null,
      market: market.get(day) ?? null,
      ...(buyPrice != null ? { buyPrice } : {}),
      ...(sellPrice != null ? { sellPrice } : {}),
    })
  }

  return out
}

/**
 * Portfolio market value per day against cumulative net cash invested.
 *
 * A ticker with no cached prices contributes to `invested` but not to `value`,
 * so the two lines stay honest instead of silently diverging.
 */
export function buildPortfolioSeries(
  entries: SpotEntry[],
  history: Record<string, { day: string; close: number }[]>,
  today: string
): PortfolioPoint[] {
  const start = firstTradeDay(entries)
  if (!start) return []

  const days = dayRange(start, today)
  const tickers = tickersOf(entries)
  const filled = new Map(tickers.map((t) => [t, fillForward(days, history[t] ?? [])]))

  const byDay = new Map<string, SpotEntry[]>()
  for (const e of sortEntries(entries)) {
    const d = e.tradedAt.slice(0, 10)
    const list = byDay.get(d)
    if (list) list.push(e)
    else byDay.set(d, [e])
  }

  const qty = new Map<string, number>(tickers.map((t) => [t, 0]))
  let invested = 0
  const out: PortfolioPoint[] = []

  for (const day of days) {
    for (const e of byDay.get(day) ?? []) {
      const held = qty.get(e.ticker) ?? 0
      if (e.side === "BUY") {
        qty.set(e.ticker, held + e.qty)
        invested += e.qty * e.price
      } else {
        const sold = Math.min(e.qty, held)
        qty.set(e.ticker, held - sold)
        invested -= sold * e.price
      }
    }

    let value = 0
    let priced = false
    for (const t of tickers) {
      const held = qty.get(t) ?? 0
      if (held <= DUST) continue
      const close = filled.get(t)?.get(day) ?? null
      if (close != null) {
        value += held * close
        priced = true
      }
    }

    out.push({ date: day, value: priced ? value : null, invested })
  }

  return out
}

/** Allocation by current market value. Unpriced or closed positions are excluded. */
export function buildAllocation(holdings: SpotHolding[]): AllocationSlice[] {
  const priced = holdings.filter((h) => h.qty > DUST && h.marketValue != null)
  const total = priced.reduce((s, h) => s + (h.marketValue ?? 0), 0)
  if (total <= 0) return []
  return priced
    .map((h) => ({
      ticker: h.ticker,
      value: h.marketValue as number,
      pct: ((h.marketValue as number) / total) * 100,
    }))
    .sort((a, b) => b.value - a.value)
}

/**
 * Units of `ticker` held right now. The entry form uses this to reject a sell
 * larger than the position before it reaches the database.
 */
export function heldQty(entries: SpotEntry[], ticker: string): number {
  let qty = 0
  for (const e of sortEntries(entries.filter((e) => e.ticker === ticker))) {
    if (e.side === "BUY") qty += e.qty
    else qty = Math.max(0, qty - e.qty)
  }
  return qty <= DUST ? 0 : qty
}
