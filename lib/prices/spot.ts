/**
 * Price sources for the spot tracker: Coinbase first, Kraken for coins Coinbase
 * does not list (e.g. XDC).
 *
 * The switch is keyed on Coinbase answering 404 for the product, never on a
 * failed or empty response. Closes are cached append-only, so falling back on a
 * Coinbase outage would permanently mix another exchange's history into a coin
 * that was always priced from Coinbase.
 */
import * as coinbase from "./coinbase"
import * as kraken from "./kraken"

/**
 * Autocomplete list: every ticker either source can price. One source being
 * down still yields a usable list; only both failing is an error.
 */
export async function fetchUsdTickers(): Promise<string[]> {
  const [cb, kr] = await Promise.allSettled([coinbase.fetchUsdTickers(), kraken.fetchUsdTickers()])
  if (cb.status === "rejected" && kr.status === "rejected") throw cb.reason
  if (cb.status === "rejected") console.error("[prices] Coinbase ticker list failed:", cb.reason)
  if (kr.status === "rejected") console.error("[prices] Kraken ticker list failed:", kr.reason)

  const all = [
    ...(cb.status === "fulfilled" ? cb.value : []),
    ...(kr.status === "fulfilled" ? kr.value : []),
  ]
  return [...new Set(all)].sort()
}

/** True only when Coinbase definitely has no USD market; a failed check is false. */
async function offCoinbase(ticker: string): Promise<boolean> {
  try {
    return !(await coinbase.hasUsdMarket(ticker))
  } catch {
    return false
  }
}

/** Live prices; tickers Coinbase does not list are asked of Kraken. */
export async function fetchCurrentPrices(tickers: string[]): Promise<Record<string, number>> {
  const out = await coinbase.fetchCurrentPrices(tickers)
  const fallback: string[] = []
  for (const t of tickers) {
    if (!(t in out) && (await offCoinbase(t))) fallback.push(t)
  }
  if (fallback.length > 0) Object.assign(out, await kraken.fetchCurrentPrices(fallback))
  return out
}

/**
 * Daily closes over [start, end]. An empty Coinbase answer is only handed to
 * Kraken once Coinbase confirms the product does not exist; an unconfirmed
 * miss throws so the caller logs it and retries on the next visit.
 */
export async function fetchDailyCloses(
  ticker: string,
  start: Date,
  end: Date
): Promise<{ day: string; close: number }[]> {
  const points = await coinbase.fetchDailyCloses(ticker, start, end)
  if (points.length > 0) return points
  if (await coinbase.hasUsdMarket(ticker)) return points
  return kraken.fetchDailyCloses(ticker, start, end)
}
