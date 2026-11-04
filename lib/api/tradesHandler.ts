import { BinanceAdapter } from "@/lib/exchanges/adapters/binance"
import { BybitAdapter } from "@/lib/exchanges/adapters/bybit"
import { OKXAdapter } from "@/lib/exchanges/adapters/okx"
import { BingXAdapter } from "@/lib/exchanges/adapters/bingx"
import { MEXCAdapter } from "@/lib/exchanges/adapters/mexc"
import { BitunixAdapter } from "@/lib/exchanges/adapters/bitunix"
import { BYDFiAdapter } from "@/lib/exchanges/adapters/bydfi"
import { getIfFresh, upsertTrades, getStoredTrades, getDeletedKeys, filterDeleted } from "@/lib/db/trades"
import { getServerCooldown, setServerCooldown } from "@/lib/db/cooldowns"
import { rateLimitFromErrorMessage, FORCE_REFRESH_MIN_INTERVAL_MS } from "@/lib/exchanges/rateLimitParse"
import type { Trade } from "@/types"
import { serverError } from "@/lib/api/errors"
import { requireUser } from "@/lib/auth/session"

export interface TradesRequestBody {
  exchange: string
  apiKey: string
  apiSecret: string
  passphrase?: string
  force?: boolean
}

async function fetchFromExchange(body: TradesRequestBody): Promise<Trade[]> {
  const { exchange, apiKey, apiSecret, passphrase = "" } = body
  switch (exchange) {
    case "Binance": return new BinanceAdapter(apiKey, apiSecret).fetchTrades()
    case "Bybit":   return new BybitAdapter(apiKey, apiSecret).fetchTrades()
    case "OKX":     return new OKXAdapter(apiKey, apiSecret, passphrase).fetchTrades()
    case "BingX":   return new BingXAdapter(apiKey, apiSecret).fetchTrades()
    case "MEXC":    return new MEXCAdapter(apiKey, apiSecret).fetchTrades()
    case "Bitunix": return new BitunixAdapter(apiKey, apiSecret).fetchTrades()
    case "BYDFi":   return new BYDFiAdapter(apiKey, apiSecret).fetchTrades()
    default:        throw new Error(`Unknown exchange: ${exchange}`)
  }
}

export async function handleTradesRequest(request: Request): Promise<Response> {
  const user = await requireUser()
  if (user instanceof Response) return user

  let body: TradesRequestBody

  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { exchange, apiKey, apiSecret, force = false } = body
  const telegramId = user.telegramId

  if (!exchange || !apiKey || !apiSecret) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  try {
    const t0 = Date.now()
    const cached = await getIfFresh(telegramId, exchange)
    console.log(`[trades] ${exchange} getIfFresh=${cached.fresh} (${Date.now() - t0}ms)`)

    if (!force && cached.fresh) {
      console.log(`[trades] ${exchange} served ${cached.trades.length} trades FROM CACHE`)
      return Response.json({ trades: cached.trades, fromCache: true })
    }

    // A forced refresh moments after a real fetch is almost always a double
    // click or an impatient retry — serve the cache instead of another burst.
    // The exchange-side fetches fan out into a dozen-plus API calls, and the
    // shared egress IP is what Binance rate-limits.
    if (force && cached.fresh && Date.now() - cached.fetchedAt.getTime() < FORCE_REFRESH_MIN_INTERVAL_MS) {
      console.log(`[trades] ${exchange} forced refresh throttled, served FROM CACHE`)
      return Response.json({ trades: cached.trades, fromCache: true, throttled: true })
    }

    // Global cooldown: some instance already got this exchange rate-limited
    // (418/429 bans hit the shared egress IP, not the user's key). Calling
    // again would only extend the ban — serve what we have stored.
    const cooldownUntil = await getServerCooldown(exchange)
    if (cooldownUntil) {
      const stored = cached.fresh ? cached.trades : await getStoredTrades(telegramId, exchange)
      console.log(`[trades] ${exchange} in cooldown until ${cooldownUntil.toISOString()}, served stored trades`)
      return Response.json({
        trades: stored,
        fromCache: true,
        stale: true,
        cooldownUntil: cooldownUntil.toISOString(),
      })
    }

    try {
      const t2 = Date.now()
      const fetched = await fetchFromExchange(body)
      console.log(`[trades] ${exchange} fetched ${fetched.length} trades FROM EXCHANGE (${Date.now() - t2}ms)`)

      const t3 = Date.now()
      await upsertTrades(telegramId, exchange, fetched)
      console.log(`[trades] ${exchange} upserted to DB (${Date.now() - t3}ms)`)

      // The exchange has no idea what the user soft-deleted — filter here, after
      // persisting, so the trade stays in the DB but never reaches the UI.
      const deletedKeys = await getDeletedKeys(telegramId, exchange)
      const trades = filterDeleted(fetched, deletedKeys)
      if (deletedKeys.size > 0) {
        console.log(`[trades] ${exchange} hid ${fetched.length - trades.length} soft-deleted trades`)
      }

      return Response.json({ trades, fromCache: false })
    } catch (fetchErr) {
      console.warn(`[trades] ${exchange} live fetch failed, falling back to stored trades:`, fetchErr)
      // A rate limit (418 IP ban / 429) must stop every instance from retrying,
      // not just this one — record it globally before answering. Never let a
      // cooldown write failure mask the fallback.
      const rateLimit = rateLimitFromErrorMessage(
        fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      )
      let cooldownUntil: string | undefined
      if (rateLimit) {
        try {
          await setServerCooldown(exchange, new Date(rateLimit.untilMs), rateLimit.reason)
          cooldownUntil = new Date(rateLimit.untilMs).toISOString()
        } catch (cdErr) {
          console.error(`[trades] ${exchange} cooldown write failed:`, cdErr)
        }
      }
      const storedTrades = cached.fresh ? cached.trades : await getStoredTrades(telegramId, exchange)
      return Response.json({ trades: storedTrades, fromCache: true, stale: true, cooldownUntil })
    }
  } catch (err) {
    return serverError("trades", err, 502)
  }
}
