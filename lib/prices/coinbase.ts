/**
 * Coinbase Exchange public market data. No API key, no geo restriction.
 *
 * Chosen over OKX/Binance because Vercel Functions for this project execute in
 * `iad1` (Washington D.C.) — both of those restrict US traffic, so a server-side
 * fetch would fail in production while working fine in local dev. Coinbase is
 * US-based, so the deploy region is a non-issue. CoinGecko was ruled out too:
 * its free tier hard-caps historical data at 365 days, and a long-term DCA
 * tracker needs to backfill further than that.
 */

const BASE = "https://api.exchange.coinbase.com"

/**
 * Coinbase returns at most 300 candles per request. The window is kept a little
 * under that so an inclusive boundary can never tip a request over the cap.
 */
const MAX_CANDLES = 290
const DAY_MS = 86_400_000
const DELAY_MS = 200

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Candle tuple order per Coinbase docs: [time, low, high, open, close, volume]. */
type CoinbaseCandle = [number, number, number, number, number, number]

interface CoinbaseProduct {
  id: string
  base_currency: string
  quote_currency: string
  status: string
  trading_disabled?: boolean
}

async function getJson<T>(url: string): Promise<T> {
  // Coinbase rejects requests without a User-Agent from some edge networks.
  const res = await fetch(url, { headers: { "User-Agent": "mfcryptoanalytics" } })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Coinbase ${res.status} on ${url}: ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

/**
 * Live USD spot pairs, base currency only (e.g. "BTC"), sorted alphabetically.
 * Drives the entry form's autocomplete — restricting input to this list is what
 * guarantees every stored ticker has a price feed behind it.
 */
export async function fetchUsdTickers(): Promise<string[]> {
  const products = await getJson<CoinbaseProduct[]>(`${BASE}/products`)
  return products
    .filter((p) => p.quote_currency === "USD" && p.status === "online" && !p.trading_disabled)
    .map((p) => p.base_currency)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .sort()
}

/**
 * Latest price for each ticker. Missing/failed tickers are omitted rather than
 * throwing — one delisted coin must not blank the whole portfolio view.
 */
export async function fetchCurrentPrices(tickers: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const ticker of tickers) {
    try {
      const data = await getJson<{ price?: string }>(`${BASE}/products/${ticker}-USD/ticker`)
      const price = Number(data.price)
      if (Number.isFinite(price)) out[ticker] = price
    } catch {
      // No feed for this ticker — leave it out; the UI renders it as unpriced.
    }
  }
  return out
}

const toDay = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Daily closes for `ticker` over [start, end], oldest first.
 *
 * Walks forward in <=300-day windows because of the per-request cap; the same
 * shape as the fills pagination in lib/exchanges/adapters/okx/spot.ts. Returns
 * [] when the ticker has no USD market rather than throwing, so one bad ticker
 * cannot break a multi-coin backfill.
 */
export async function fetchDailyCloses(
  ticker: string,
  start: Date,
  end: Date
): Promise<{ day: string; close: number }[]> {
  const byDay = new Map<string, number>()
  let cursor = start.getTime()
  const endMs = end.getTime()

  while (cursor <= endMs) {
    const windowEnd = Math.min(cursor + (MAX_CANDLES - 1) * DAY_MS, endMs)
    const url =
      `${BASE}/products/${ticker}-USD/candles?granularity=86400` +
      `&start=${new Date(cursor).toISOString()}&end=${new Date(windowEnd).toISOString()}`

    let candles: CoinbaseCandle[]
    try {
      candles = await getJson<CoinbaseCandle[]>(url)
    } catch {
      // A ticker with no USD market fails on the first window and yields [].
      // A window that fails midway keeps whatever earlier windows returned
      // rather than throwing the whole backfill away.
      break
    }

    for (const c of candles) {
      const [time, , , , close] = c
      if (Number.isFinite(time) && Number.isFinite(close)) {
        byDay.set(toDay(new Date(time * 1000)), close)
      }
    }

    cursor = windowEnd + DAY_MS
    if (cursor <= endMs) await sleep(DELAY_MS)
  }

  return [...byDay.entries()]
    .map(([day, close]) => ({ day, close }))
    .sort((a, b) => a.day.localeCompare(b.day))
}
