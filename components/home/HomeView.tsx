'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useUserStore } from '@/lib/store/userStore'
import { StatsBar } from '@/components/dashboard/StatsBar'
import { PnlChart } from '@/components/dashboard/PnlChart'
import { TradesTable } from '@/components/dashboard/TradesTable'
import { computeStats } from '@/lib/services/statsService'
import { fetchAllBalances, type BalanceResult } from '@/lib/services/balanceService'
import { LandingPage } from '@/components/home/LandingPage'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import type { Trade } from '@/types'
import { fetchFuturesTrades as fetchBinanceFutures } from '@/lib/exchanges/adapters/binance/futures'
import { fetchFuturesTrades as fetchBybitFutures } from '@/lib/exchanges/adapters/bybit/futures'

const PERIODS = [
  { label: '1d',  days: 1 },
  { label: '1w',  days: 7 },
  { label: '2w',  days: 14 },
  { label: '1m',  days: 30 },
  { label: '3m',  days: 90 },
  { label: '6m',  days: 180 },
  { label: '1y',  days: 365 },
  { label: '2y',  days: 730 },
] as const

type PeriodLabel = typeof PERIODS[number]['label']

interface ExchangeConfig {
  name: string
  apiKey: string
  apiSecret: string
  passphrase?: string
}

// Exchanges that require Singapore region (geo-blocked from US/EU)
const ASIA_EXCHANGES = new Set(['BingX', 'MEXC'])

// Exchanges geo-blocked on Vercel servers — fetch directly from the browser instead
const CLIENT_FETCH_EXCHANGES = new Set(['Binance', 'Bybit'])

async function fetchExchangeTradesClientSide(
  telegramId: string,
  cfg: ExchangeConfig,
  force: boolean
): Promise<Trade[]> {
  // 1. Check for a fresh cache first
  if (!force) {
    const cacheRes = await fetch('/api/trades-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId, exchange: cfg.name }),
    })
    const cacheData = await cacheRes.json()
    if (cacheData.fresh) {
      console.log(`[HomeView] ${cfg.name} fromCache=true trades=${cacheData.trades.length}`)
      return cacheData.trades as Trade[]
    }
  }

  // 2. Fetch directly from the exchange in the browser (bypasses Vercel geo-blocks)
  let since: number | undefined

  if (cfg.name === 'Binance') {
    // Only fetch trades newer than the latest cached one to minimise requests
    try {
      const latestRes = await fetch('/api/trades-latest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId, exchange: cfg.name }),
      })
      const latestData = await latestRes.json()
      if (typeof latestData.latestMs === 'number') since = latestData.latestMs
    } catch { /* ignore — fall back to full lookback */ }
  }

  // Fetch new trades from exchange + existing cached trades in parallel
  const [newTrades, cachedResult] = await Promise.all([
    cfg.name === 'Binance'
      ? fetchBinanceFutures(cfg.apiKey, cfg.apiSecret, since)
      : fetchBybitFutures(cfg.apiKey, cfg.apiSecret),
    since != null
      ? fetch('/api/trades-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telegramId, exchange: cfg.name }),
        }).then((r) => r.json()).then((d) => (d.trades ?? []) as Trade[]).catch(() => [] as Trade[])
      : Promise.resolve([] as Trade[]),
  ])

  // Merge: cached trades + newly fetched, deduplicated by id
  const idSet = new Set(cachedResult.map((t: Trade) => t.id))
  const dedupedNew = newTrades.filter((t) => !idSet.has(t.id))
  const trades = [...cachedResult, ...dedupedNew]

  console.log(`[HomeView] ${cfg.name} cached=${cachedResult.length} new=${dedupedNew.length} total=${trades.length} (client-side)`)

  // 3. Store only the new trades to DB in background (don't block the UI)
  if (dedupedNew.length > 0) {
    fetch('/api/trades-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId, exchange: cfg.name, trades: dedupedNew }),
    }).catch((err) => console.warn(`[HomeView] ${cfg.name} store failed:`, err))
  } else {
    // No new trades — still update the fetch log so cache freshness resets
    fetch('/api/trades-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId, exchange: cfg.name, trades: [] }),
    }).catch((err) => console.warn(`[HomeView] ${cfg.name} store failed:`, err))
  }

  return trades
}

async function fetchExchangeTrades(
  telegramId: string,
  cfg: ExchangeConfig,
  force: boolean
): Promise<Trade[]> {
  if (CLIENT_FETCH_EXCHANGES.has(cfg.name)) {
    return fetchExchangeTradesClientSide(telegramId, cfg, force)
  }
  const endpoint = ASIA_EXCHANGES.has(cfg.name) ? '/api/trades-asia' : '/api/trades-global'
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      telegramId,
      exchange: cfg.name,
      apiKey: cfg.apiKey,
      apiSecret: cfg.apiSecret,
      passphrase: cfg.passphrase ?? '',
      force,
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  console.log(`[HomeView] ${cfg.name} fromCache=${data.fromCache} trades=${data.trades?.length}`)
  return data.trades as Trade[]
}

export function HomeView() {
  const telegramId = useUserStore((s) => s.telegramId)
  const apiKeys = useUserStore((s) => s.apiKeys)

  const [trades, setTrades] = useState<Trade[]>([])
  const [loadedExchanges, setLoadedExchanges] = useState<string[]>([])
  const [exchangeErrors, setExchangeErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [balanceResult, setBalanceResult] = useState<BalanceResult | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [period, setPeriod] = useState<PeriodLabel>('3m')

  const buildExchangeConfigs = useCallback((): ExchangeConfig[] => {
    const configs: ExchangeConfig[] = []
    if (apiKeys.binanceApiKey && apiKeys.binanceApiSecret)
      configs.push({ name: 'Binance', apiKey: apiKeys.binanceApiKey, apiSecret: apiKeys.binanceApiSecret })
    if (apiKeys.bybitApiKey && apiKeys.bybitApiSecret)
      configs.push({ name: 'Bybit', apiKey: apiKeys.bybitApiKey, apiSecret: apiKeys.bybitApiSecret })
    if (apiKeys.okxApiKey && apiKeys.okxApiSecret && apiKeys.okxPassphrase)
      configs.push({ name: 'OKX', apiKey: apiKeys.okxApiKey, apiSecret: apiKeys.okxApiSecret, passphrase: apiKeys.okxPassphrase })
    if (apiKeys.bingxApiKey && apiKeys.bingxApiSecret)
      configs.push({ name: 'BingX', apiKey: apiKeys.bingxApiKey, apiSecret: apiKeys.bingxApiSecret })
    if (apiKeys.mexcApiKey && apiKeys.mexcApiSecret)
      configs.push({ name: 'MEXC', apiKey: apiKeys.mexcApiKey, apiSecret: apiKeys.mexcApiSecret })
    if (apiKeys.bitunixApiKey && apiKeys.bitunixApiSecret)
      configs.push({ name: 'Bitunix', apiKey: apiKeys.bitunixApiKey, apiSecret: apiKeys.bitunixApiSecret })
    if (apiKeys.bydfiApiKey && apiKeys.bydfiApiSecret)
      configs.push({ name: 'BYDFi', apiKey: apiKeys.bydfiApiKey, apiSecret: apiKeys.bydfiApiSecret })
    return configs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    apiKeys.binanceApiKey, apiKeys.binanceApiSecret,
    apiKeys.bybitApiKey, apiKeys.bybitApiSecret,
    apiKeys.okxApiKey, apiKeys.okxApiSecret, apiKeys.okxPassphrase,
    apiKeys.bingxApiKey, apiKeys.bingxApiSecret,
    apiKeys.mexcApiKey, apiKeys.mexcApiSecret,
    apiKeys.bitunixApiKey, apiKeys.bitunixApiSecret,
    apiKeys.bydfiApiKey, apiKeys.bydfiApiSecret,
  ])

  const runFetch = useCallback((force: boolean) => {
    if (!telegramId) return
    const configs = buildExchangeConfigs()
    if (configs.length === 0) return

    let cancelled = false
    setTrades([])
    setLoadedExchanges([])
    setExchangeErrors({})
    setLoading(true)

    function addTrades(newTrades: Trade[], name: string) {
      setTrades((prev) => {
        const merged = [...prev, ...newTrades]
        merged.sort((a, b) => new Date(b.closeTime).getTime() - new Date(a.closeTime).getTime())
        return merged
      })
      setLoadedExchanges((prev) => [...prev, name])
    }

    Promise.all(
      configs.map(async (cfg) => {
        try {
          const newTrades = await fetchExchangeTrades(telegramId, cfg, force)
          if (!cancelled) addTrades(newTrades, cfg.name)
        } catch (err) {
          if (!cancelled) {
            setExchangeErrors((prev) => ({ ...prev, [cfg.name]: String(err) }))
            setLoadedExchanges((prev) => [...prev, cfg.name])
          }
        }
      })
    ).then(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [telegramId, buildExchangeConfigs])

  useEffect(() => {
    return runFetch(false) ?? undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramId,
    apiKeys.binanceApiKey, apiKeys.binanceApiSecret,
    apiKeys.bybitApiKey, apiKeys.bybitApiSecret,
    apiKeys.bingxApiKey, apiKeys.bingxApiSecret,
    apiKeys.mexcApiKey, apiKeys.mexcApiSecret,
    apiKeys.okxApiKey, apiKeys.okxApiSecret, apiKeys.okxPassphrase,
    apiKeys.bitunixApiKey, apiKeys.bitunixApiSecret,
    apiKeys.bydfiApiKey, apiKeys.bydfiApiSecret,
  ])

  useEffect(() => {
    if (!telegramId) return
    const hasAnyKey = (
      (apiKeys.binanceApiKey && apiKeys.binanceApiSecret) ||
      (apiKeys.bybitApiKey && apiKeys.bybitApiSecret) ||
      (apiKeys.okxApiKey && apiKeys.okxApiSecret && apiKeys.okxPassphrase) ||
      (apiKeys.bingxApiKey && apiKeys.bingxApiSecret) ||
      (apiKeys.mexcApiKey && apiKeys.mexcApiSecret)
    )
    if (!hasAnyKey) return

    let cancelled = false
    setBalanceResult(null)
    setBalanceLoading(true)

    fetchAllBalances(apiKeys).then((result) => {
      if (!cancelled) {
        setBalanceResult(result)
        setBalanceLoading(false)
      }
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    telegramId,
    apiKeys.binanceApiKey, apiKeys.binanceApiSecret,
    apiKeys.bybitApiKey, apiKeys.bybitApiSecret,
    apiKeys.bingxApiKey, apiKeys.bingxApiSecret,
    apiKeys.mexcApiKey, apiKeys.mexcApiSecret,
    apiKeys.okxApiKey, apiKeys.okxApiSecret, apiKeys.okxPassphrase,
  ])

  const filteredTrades = useMemo(() => {
    const days = PERIODS.find((p) => p.label === period)?.days ?? 90
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    return trades.filter((t) => new Date(t.closeTime).getTime() >= cutoff)
  }, [trades, period])

  const stats = computeStats(filteredTrades)
  const hasAnyKey = buildExchangeConfigs().length > 0

  if (!telegramId) return <LandingPage />

  return (
    <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 space-y-6">
      {!hasAnyKey && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-400/50 bg-yellow-400/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          <span>
            No exchange API keys configured. Open <strong>Settings</strong> and add at least one exchange to start tracking your trades.
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            <span className="font-medium">
              {loadedExchanges.length === 0
                ? 'Data is Loading…'
                : `Data is Loading… (${loadedExchanges.join(', ')} ready)`}
            </span>
          </div>
        ) : (
          <button
            onClick={() => runFetch(true)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        )}
        {/* Mobile: dropdown */}
        <div className="relative sm:hidden overflow-hidden">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodLabel)}
            className="appearance-none rounded-lg border bg-muted/40 pl-2 pr-7 py-1.5 text-sm font-medium text-foreground focus:outline-none"
          >
            {PERIODS.map(({ label }) => (
              <option key={label} value={label}>{label}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
            <svg className="h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
        {/* Desktop: pill group */}
        <div className="hidden sm:flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
          {PERIODS.map(({ label }) => (
            <button
              key={label}
              onClick={() => setPeriod(label)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                period === label
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <StatsBar stats={stats} balanceResult={balanceResult} balanceLoading={balanceLoading} />
      <PnlChart chartData={stats.chartData} />
      {Object.entries(exchangeErrors).length > 0 && (
        <div className="text-xs text-destructive space-y-1 border border-destructive/30 rounded p-3 bg-destructive/5">
          <p className="font-semibold">Exchange errors:</p>
          {Object.entries(exchangeErrors).map(([exchange, err]) => (
            <p key={exchange}><span className="font-medium">{exchange}:</span> {err}</p>
          ))}
        </div>
      )}
      <TradesTable trades={filteredTrades} />
    </main>
  )
}
