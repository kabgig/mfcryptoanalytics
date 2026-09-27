/**
 * Kraken public market data — the fallback for coins Coinbase does not list
 * (e.g. XDC). No API key, and US-based like Coinbase, so the `iad1` deploy
 * region is not a problem. See lib/prices/spot.ts for when it is used.
 *
 * Kraken's daily OHLC endpoint only ever returns the most recent 720 candles,
 * so history is capped at roughly two years back (or the listing date).
 */

const BASE = "https://api.kraken.com/0/public"
const DAY_MS = 86_400_000

/**
 * Kraken's own names for a few majors. Mapped both ways so the rest of the app
 * only ever sees the common ticker ("BTC", never "XBT").
 */
const FROM_KRAKEN: Record<string, string> = { XBT: "BTC", XDG: "DOGE" }
const TO_KRAKEN: Record<string, string> = Object.fromEntries(
  Object.entries(FROM_KRAKEN).map(([k, v]) => [v, k])
)

const pairOf = (ticker: string) => `${TO_KRAKEN[ticker] ?? ticker}USD`

interface KrakenPair {
  wsname?: string
  status?: string
}

/** OHLC tuple: [time, open, high, low, close, vwap, volume, count]. */
type KrakenCandle = [number, string, string, string, string, string, string, number]

/** Kraken reports failures as HTTP 200 with a non-empty `error` array. */
async function getResult<T>(path: string): Promise<T> {
  const url = `${BASE}${path}`
  const res = await fetch(url, { headers: { "User-Agent": "mfcryptoanalytics" } })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Kraken ${res.status} on ${url}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as { error?: string[]; result?: T }
  if (data.error?.length || !data.result) {
    throw new Error(`Kraken error on ${url}: ${(data.error ?? []).join(", ")}`)
  }
  return data.result
}

/** Live USD pairs as common base tickers (e.g. "XDC", "BTC"), sorted. */
export async function fetchUsdTickers(): Promise<string[]> {
  const pairs = await getResult<Record<string, KrakenPair>>("/AssetPairs")
  return Object.values(pairs)
    .filter((p) => p.status === "online" && p.wsname?.endsWith("/USD"))
    .map((p) => {
      const base = p.wsname!.slice(0, -"/USD".length)
      return FROM_KRAKEN[base] ?? base
    })
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .sort()
}

/** Latest price per ticker; tickers without a Kraken USD pair are omitted. */
export async function fetchCurrentPrices(tickers: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const ticker of tickers) {
    try {
      const result = await getResult<Record<string, { c?: [string, string] }>>(
        `/Ticker?pair=${pairOf(ticker)}`
      )
      // The result key is Kraken's internal pair name (e.g. "XXBTZUSD"), so
      // take the single entry rather than looking it up by our name.
      const price = Number(Object.values(result)[0]?.c?.[0])
      if (Number.isFinite(price) && price > 0) out[ticker] = price
    } catch {
      // No Kraken market for this ticker — leave it out, it renders unpriced.
    }
  }
  return out
}

const toDay = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Daily closes for `ticker` over [start, end], oldest first. Returns [] when
 * Kraken has no USD market, matching the Coinbase client's contract.
 */
export async function fetchDailyCloses(
  ticker: string,
  start: Date,
  end: Date
): Promise<{ day: string; close: number }[]> {
  const startDay = toDay(start)
  const endDay = toDay(end)
  // `since` is exclusive, so step back a day to keep `start` itself.
  const since = Math.floor((start.getTime() - DAY_MS) / 1000)

  let result: Record<string, KrakenCandle[] | number>
  try {
    result = await getResult(`/OHLC?pair=${pairOf(ticker)}&interval=1440&since=${since}`)
  } catch {
    return []
  }

  const candles = Object.entries(result).find(([k]) => k !== "last")?.[1]
  if (!Array.isArray(candles)) return []

  return candles
    .map(([time, , , , close]) => ({ day: toDay(new Date(time * 1000)), close: Number(close) }))
    .filter((p) => p.day >= startDay && p.day <= endDay && Number.isFinite(p.close))
    .sort((a, b) => a.day.localeCompare(b.day))
}
