import { fetchUsdTickers } from "@/lib/prices/coinbase"

/**
 * Tradable USD tickers for the entry form's autocomplete.
 *
 * Cached for a day at the CDN: the listing set barely moves, and this is the
 * only spot route that does not depend on a specific user.
 */
export const revalidate = 86400

export async function GET() {
  try {
    return Response.json({ tickers: await fetchUsdTickers() })
  } catch (err) {
    console.error("[spot/symbols] GET error:", err)
    return Response.json({ error: "Could not load ticker list" }, { status: 502 })
  }
}
