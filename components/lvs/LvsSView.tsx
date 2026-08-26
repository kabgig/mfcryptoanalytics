"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useUserStore } from "@/lib/store/userStore"
import { computeLvsS } from "@/lib/services/lvsService"
import type { SideStats } from "@/lib/services/lvsService"
import Link from "next/link"
import { LandingPage } from "@/components/home/LandingPage"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RefreshCw, TriangleAlert, TrendingUp, TrendingDown, Minus } from "lucide-react"
import type { Trade, TradeOverridesMap } from "@/types"
import { fetchFuturesTrades as fetchBinanceFutures } from "@/lib/exchanges/adapters/binance/futures"
import { fetchFuturesTrades as fetchBybitFutures } from "@/lib/exchanges/adapters/bybit/futures"

import { PeriodSelector } from "@/components/ui/PeriodSelector"
import { usePeriodStore } from "@/lib/store/periodStore"
import { filterTradesBySelection } from "@/lib/constants/periods"

interface ExchangeConfig {
  name: string
  apiKey: string
  apiSecret: string
  passphrase?: string
}

const ASIA_EXCHANGES = new Set(["BingX", "MEXC"])
const CLIENT_FETCH_EXCHANGES = new Set(["Binance", "Bybit"])

async function fetchExchangeTradesClientSide(
  telegramId: string,
  cfg: ExchangeConfig,
  force: boolean
): Promise<Trade[]> {
  if (!force) {
    const cacheRes = await fetch("/api/trades-cache", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramId, exchange: cfg.name }),
    })
    const cacheData = await cacheRes.json()
    if (cacheData.fresh) return cacheData.trades as Trade[]
  }

  let trades: Trade[]
  if (cfg.name === "Binance") {
    trades = await fetchBinanceFutures(cfg.apiKey, cfg.apiSecret)
  } else if (cfg.name === "Bybit") {
    trades = await fetchBybitFutures(cfg.apiKey, cfg.apiSecret)
  } else {
    throw new Error(`Unexpected client-fetch exchange: ${cfg.name}`)
  }

  const storeRes = await fetch("/api/trades-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegramId, exchange: cfg.name, trades }),
  })
  if (!storeRes.ok) {
    const err = await storeRes.json().catch(() => ({}))
    console.warn(`[trades-store] ${cfg.name} persist failed:`, err.error ?? storeRes.status)
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
  const endpoint = ASIA_EXCHANGES.has(cfg.name) ? "/api/trades-asia" : "/api/trades-global"
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telegramId,
      exchange: cfg.name,
      apiKey: cfg.apiKey,
      apiSecret: cfg.apiSecret,
      passphrase: cfg.passphrase ?? "",
      force,
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data.trades as Trade[]
}

function fmt(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
}

/**
 * A PnL figure with its sign and colour. "Best" and "worst" are positions in the
 * bucket, not guarantees about profit: a losing bucket's best trade is still a
 * loss, and an all-winning bucket's worst trade is still a profit, so neither
 * row can hardcode a sign or a colour.
 */
function SignedPnl({ value, testid }: { value: number; testid?: string }) {
  const positive = value >= 0
  return (
    <span data-testid={testid} className={positive ? "text-emerald-500" : "text-red-500"}>
      {positive ? "+" : ""}{fmt(value)}
    </span>
  )
}

function StatRow({ label, value, colored }: { label: string; value: React.ReactNode; colored?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${colored ? "text-foreground" : ""}`}>
        {value}
      </span>
    </div>
  )
}

function SideCard({
  label,
  stats,
  color,
  icon,
  testid,
}: {
  label: string
  stats: SideStats
  color: string
  icon: React.ReactNode
  testid: string
}) {
  return (
    <Card className="flex-1 min-w-[240px]" data-testid={testid}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <span style={{ color }}>{icon}</span>
          <CardTitle className="text-base" style={{ color }}>
            {label}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {stats.tradeCount === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No trades</p>
        ) : (
          <>
            <StatRow
              label="Total PnL"
              value={<SignedPnl value={stats.totalPnl} testid={`${testid}-pnl`} />}
            />
            <StatRow
              label="Win Rate"
              value={`${stats.winRate}%`}
            />
            <StatRow
              label="Trade Count"
              value={
                <span data-testid={`${testid}-count`}>{stats.tradeCount.toLocaleString()}</span>
              }
            />
            <StatRow
              label="Wins / Losses"
              value={
                <span>
                  <span className="text-emerald-500">{stats.winCount}</span>
                  {" / "}
                  <span className="text-red-500">{stats.lossCount}</span>
                </span>
              }
            />
            <StatRow
              label="Avg PnL"
              value={<SignedPnl value={stats.avgPnl} testid={`${testid}-avg`} />}
            />
            <StatRow
              label="Best Trade"
              value={<SignedPnl value={stats.bestTrade} testid={`${testid}-best`} />}
            />
            <StatRow
              label="Worst Trade"
              value={<SignedPnl value={stats.worstTrade} testid={`${testid}-worst`} />}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function LvsSView() {
  const telegramId = useUserStore((s) => s.telegramId)
  const apiKeys = useUserStore((s) => s.apiKeys)

  const [trades, setTrades] = useState<Trade[]>([])
  const [importedTrades, setImportedTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(false)
  const [loadedExchanges, setLoadedExchanges] = useState<string[]>([])
  const [exchangeErrors, setExchangeErrors] = useState<Record<string, string>>({})
  const [overrides, setOverrides] = useState<TradeOverridesMap>({})
  const period = usePeriodStore((s) => s.selection)
  const setPeriod = usePeriodStore((s) => s.setSelection)

  const buildExchangeConfigs = useCallback((): ExchangeConfig[] => {
    const configs: ExchangeConfig[] = []
    if (apiKeys.binanceApiKey && apiKeys.binanceApiSecret)
      configs.push({ name: "Binance", apiKey: apiKeys.binanceApiKey, apiSecret: apiKeys.binanceApiSecret })
    if (apiKeys.bybitApiKey && apiKeys.bybitApiSecret)
      configs.push({ name: "Bybit", apiKey: apiKeys.bybitApiKey, apiSecret: apiKeys.bybitApiSecret })
    if (apiKeys.okxApiKey && apiKeys.okxApiSecret && apiKeys.okxPassphrase)
      configs.push({ name: "OKX", apiKey: apiKeys.okxApiKey, apiSecret: apiKeys.okxApiSecret, passphrase: apiKeys.okxPassphrase })
    if (apiKeys.bingxApiKey && apiKeys.bingxApiSecret)
      configs.push({ name: "BingX", apiKey: apiKeys.bingxApiKey, apiSecret: apiKeys.bingxApiSecret })
    if (apiKeys.mexcApiKey && apiKeys.mexcApiSecret)
      configs.push({ name: "MEXC", apiKey: apiKeys.mexcApiKey, apiSecret: apiKeys.mexcApiSecret })
    if (apiKeys.bitunixApiKey && apiKeys.bitunixApiSecret)
      configs.push({ name: "Bitunix", apiKey: apiKeys.bitunixApiKey, apiSecret: apiKeys.bitunixApiSecret })
    if (apiKeys.bydfiApiKey && apiKeys.bydfiApiSecret)
      configs.push({ name: "BYDFi", apiKey: apiKeys.bydfiApiKey, apiSecret: apiKeys.bydfiApiSecret })
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

    if (configs.length === 0) {
      setTrades([])
      setLoadedExchanges([])
      setExchangeErrors({})
      setLoading(true)
      fetch('/api/trades-cache/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId }),
      })
        .then((r) => r.json())
        .then((data) => {
          const t = (data.trades ?? []) as Trade[]
          t.sort((a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime())
          setTrades(t)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
      return
    }

    let cancelled = false
    setTrades([])
    setLoadedExchanges([])
    setExchangeErrors({})
    setLoading(true)

    Promise.all(
      configs.map(async (cfg) => {
        try {
          const newTrades = await fetchExchangeTrades(telegramId, cfg, force)
          if (!cancelled) {
            setTrades((prev) => {
              const merged = [...prev, ...newTrades]
              merged.sort((a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime())
              return merged
            })
            setLoadedExchanges((prev) => [...prev, cfg.name])
          }
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

  // Load manually-imported trades (no expiry — always show all stored)
  useEffect(() => {
    if (!telegramId) return
    let cancelled = false
    const IMPORTED_EXCHANGES = ["Jupiter Perps", "bluefin"]
    Promise.all(
      IMPORTED_EXCHANGES.map((exchange) =>
        fetch("/api/import/trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegramId, exchange }),
        }).then((r) => r.json())
      )
    )
      .then((results) => {
        if (!cancelled) {
          const merged = results.flatMap((data) => (data.trades ?? []) as Trade[])
          setImportedTrades(merged)
        }
      })
      .catch(() => { /* non-critical */ })
    return () => { cancelled = true }
  }, [telegramId])

  // The hand-set Bias for each trade. Most exchanges never report long/short, so
  // for those this map is the only thing that puts a trade in a bucket at all.
  useEffect(() => {
    if (!telegramId) return
    let cancelled = false
    fetch(`/api/trades/overrides?telegramId=${encodeURIComponent(telegramId)}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setOverrides((data.overrides ?? {}) as TradeOverridesMap) })
      .catch(() => { /* non-critical — the split falls back to the exchange's side */ })
    return () => { cancelled = true }
  }, [telegramId])

  const hasAnyKey = buildExchangeConfigs().length > 0
  const errorEntries = Object.entries(exchangeErrors)

  const filteredTrades = useMemo(() => {
    const all = [...trades, ...importedTrades]
    all.sort((a, b) => new Date(b.closeTime).getTime() - new Date(a.closeTime).getTime())
    return filterTradesBySelection(all, period)
  }, [trades, importedTrades, period])

  const result = useMemo(
    () => computeLvsS(filteredTrades, overrides),
    [filteredTrades, overrides]
  )

  // Only worth naming the unbiased trades' exchanges when they are not simply
  // the exchanges the notice has already called out as reporting no side.
  const unknownFrom =
    result.unknownExchanges.join(",") === result.exchangesWithoutSide.join(",")
      ? null
      : result.unknownExchanges.join(", ")

  if (!telegramId) return <LandingPage />

  return (
    <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 space-y-6">
      {!hasAnyKey && importedTrades.length === 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-400/50 bg-yellow-400/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          <span>
            No data yet. Open <strong>Settings</strong> to add exchange API keys, or use{" "}
            <a href="/import/jupiter" className="underline underline-offset-2 hover:opacity-80">Import → Jupiter Dex</a>{" "}
            to upload a trade history CSV.
          </span>
        </div>
      )}

      {errorEntries.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-red-400/50 bg-red-400/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {errorEntries.map(([name, msg]) => (
            <span key={name}><strong>{name}:</strong> {msg}</span>
          ))}
        </div>
      )}

      {result.unknownCount > 0 && (
        <div
          data-testid="lvs-unknown-note"
          className="flex items-start gap-3 rounded-lg border border-yellow-400/50 bg-yellow-400/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300"
        >
          <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            {result.exchangesWithoutSide.length > 0 && (
              <>
                <strong>{result.exchangesWithoutSide.join(", ")}</strong>{" "}
                {result.exchangesWithoutSide.length === 1 ? "does" : "do"} not report
                long/short, so only a <strong>Bias</strong> you set by hand is counted for{" "}
                {result.exchangesWithoutSide.length === 1 ? "it" : "them"}.{" "}
              </>
            )}
            <strong>{result.unknownCount} trade{result.unknownCount !== 1 ? "s" : ""}</strong>{" "}
            {result.unknownCount === 1 ? "has" : "have"} no bias yet and{" "}
            {result.unknownCount === 1 ? "is" : "are"} left out of this view — set{" "}
            {result.unknownCount === 1 ? "it" : "them"} in the{" "}
            <Link href="/" className="underline underline-offset-2 hover:opacity-80">Bias column</Link>{" "}
            on the dashboard{unknownFrom ? ` (${unknownFrom})` : ""}.
          </span>
        </div>
      )}

      {result.manualCount > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="lvs-manual-note">
          Counting{" "}
          <strong className="font-medium text-foreground">
            {result.manualCount} trade{result.manualCount !== 1 ? "s" : ""}
          </strong>{" "}
          from a Bias you set by hand.
        </p>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight">Long vs Short</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <PeriodSelector value={period} onChange={setPeriod} />
          {loading ? (
            <div className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <span className="font-medium">
                {loadedExchanges.length === 0
                  ? "Loading…"
                  : `Loading… (${loadedExchanges.join(", ")} ready)`}
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
        </div>
      </div>

      {filteredTrades.length === 0 && !loading ? (
        <Card>
          <CardContent className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No trade data available for this period.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col sm:flex-row gap-4">
          <SideCard
            testid="lvs-long"
            label="Long"
            stats={result.long}
            color="#22c55e"
            icon={<TrendingUp className="h-5 w-5" />}
          />
          <div className="hidden sm:flex items-center justify-center">
            <Minus className="h-5 w-5 text-muted-foreground rotate-90" />
          </div>
          <SideCard
            testid="lvs-short"
            label="Short"
            stats={result.short}
            color="#f87171"
            icon={<TrendingDown className="h-5 w-5" />}
          />
        </div>
      )}

      {result.long.tradeCount > 0 && result.short.tradeCount > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">PnL edge</p>
                {(() => {
                  const diff = result.long.totalPnl - result.short.totalPnl
                  const positive = diff >= 0
                  return (
                    <p className={`text-sm font-semibold tabular-nums ${positive ? "text-emerald-500" : "text-red-500"}`}>
                      {positive ? "Longs +" : "Shorts +"}{Math.abs(diff).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                    </p>
                  )
                })()}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Win rate edge</p>
                {(() => {
                  const diff = result.long.winRate - result.short.winRate
                  const positive = diff >= 0
                  return (
                    <p className={`text-sm font-semibold ${positive ? "text-emerald-500" : "text-red-500"}`}>
                      {positive ? "Longs +" : "Shorts +"}{Math.abs(diff).toFixed(1)}%
                    </p>
                  )
                })()}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Long trades</p>
                <p className="text-sm font-semibold">{result.long.tradeCount.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Short trades</p>
                <p className="text-sm font-semibold">{result.short.tradeCount.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
