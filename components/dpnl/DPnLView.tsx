"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useUserStore } from "@/lib/store/userStore"
import { computeDPnL, fmtDuration } from "@/lib/services/dpnlService"
import { LandingPage } from "@/components/home/LandingPage"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RefreshCw, TriangleAlert } from "lucide-react"
import type { Trade } from "@/types"
import { fetchFuturesTrades as fetchBinanceFutures } from "@/lib/exchanges/adapters/binance/futures"
import { fetchFuturesTrades as fetchBybitFutures } from "@/lib/exchanges/adapters/bybit/futures"
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

const PERIODS = [
  { label: "1d",  days: 1 },
  { label: "1w",  days: 7 },
  { label: "2w",  days: 14 },
  { label: "1m",  days: 30 },
  { label: "3m",  days: 90 },
  { label: "6m",  days: 180 },
  { label: "1y",  days: 365 },
  { label: "2y",  days: 730 },
] as const

type PeriodLabel = typeof PERIODS[number]["label"]

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

  fetch("/api/trades-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegramId, exchange: cfg.name, trades }),
  }).catch(() => {})

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

interface TooltipPayloadEntry {
  dataKey: string
  value: number
  payload: {
    id: string
    ticker: string
    exchange: string
    x: number
    y: number
    win: boolean
  }
}

function DPnLTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadEntry[] }) {
  if (!active || !payload?.length) return null
  const pt = payload[0].payload
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-md space-y-0.5">
      <p className="font-semibold text-foreground">{pt.ticker}</p>
      <p className="text-muted-foreground">{pt.exchange}</p>
      <p className="text-muted-foreground">Duration: <span className="text-foreground font-medium">{fmtDuration(pt.x)}</span></p>
      <p className={`font-medium ${pt.win ? "text-emerald-500" : "text-red-500"}`}>
        PnL: {pt.y >= 0 ? "+" : ""}{pt.y.toLocaleString("en-US", { style: "currency", currency: "USD" })}
      </p>
    </div>
  )
}

function fmt(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
}

export function DPnLView() {
  const telegramId = useUserStore((s) => s.telegramId)
  const apiKeys = useUserStore((s) => s.apiKeys)

  const [trades, setTrades] = useState<Trade[]>([])
  const [jupiterTrades, setJupiterTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(false)
  const [loadedExchanges, setLoadedExchanges] = useState<string[]>([])
  const [exchangeErrors, setExchangeErrors] = useState<Record<string, string>>({})
  const [period, setPeriod] = useState<PeriodLabel>("3m")

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
    if (configs.length === 0) return

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

  // Load Jupiter Perps imported trades (no expiry — always show all stored)
  useEffect(() => {
    if (!telegramId) return
    let cancelled = false
    fetch("/api/import/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramId, exchange: "Jupiter Perps" }),
    })
      .then((r) => r.json())
      .then((data) => { if (!cancelled && data.trades) setJupiterTrades(data.trades as Trade[]) })
      .catch(() => { /* non-critical */ })
    return () => { cancelled = true }
  }, [telegramId])

  const hasAnyKey = buildExchangeConfigs().length > 0
  const errorEntries = Object.entries(exchangeErrors)

  const filteredTrades = useMemo(() => {
    const days = PERIODS.find((p) => p.label === period)?.days ?? 90
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const all = [...trades, ...jupiterTrades]
    all.sort((a, b) => new Date(b.closeTime).getTime() - new Date(a.closeTime).getTime())
    return all.filter((t) => new Date(t.closeTime).getTime() >= cutoff)
  }, [trades, jupiterTrades, period])

  const result = useMemo(() => computeDPnL(filteredTrades), [filteredTrades])

  const totalPoints = result.wins.length + result.losses.length

  // Format X axis ticks as duration
  const xTickFormatter = (v: number) => fmtDuration(v)

  if (!telegramId) return <LandingPage />

  return (
    <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 space-y-6">
      {!hasAnyKey && jupiterTrades.length === 0 && (
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

      {result.noDurationExchanges.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-400/50 bg-yellow-400/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300">
          <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <strong>{result.noDurationExchanges.join(", ")}</strong>{" "}
            {result.noDurationExchanges.length === 1 ? "does" : "do"} not provide open time data —
            all trades from {result.noDurationExchanges.length === 1 ? "this exchange" : "these exchanges"} are excluded from the chart.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight">Duration vs PnL</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Period selector – mobile */}
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
          {/* Period selector – desktop */}
          <div className="hidden sm:flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
            {PERIODS.map(({ label }) => (
              <button
                key={label}
                onClick={() => setPeriod(label)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  period === label
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hold Duration vs PnL</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each dot is one trade. X = how long it was held, Y = PnL.
            Green = winner, red = loser. Should you hold longer or cut faster?
          </p>
        </CardHeader>
        <CardContent>
          {totalPoints === 0 && !loading ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              No trade data available for this period.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Duration"
                  tickFormatter={xTickFormatter}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  label={{ value: "Hold Duration", position: "insideBottom", offset: -2, fontSize: 11, fill: "currentColor", opacity: 0.5 }}
                  className="fill-muted-foreground"
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="PnL"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${v}`}
                  className="fill-muted-foreground"
                />
                <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="4 4" />
                <Tooltip content={<DPnLTooltip />} cursor={{ strokeDasharray: "3 3" }} />
                <Legend
                  wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                  formatter={(value) => <span className="text-foreground">{value}</span>}
                />
                <Scatter
                  name="Wins"
                  data={result.wins}
                  fill="#22c55e"
                  fillOpacity={0.65}
                  r={4}
                />
                <Scatter
                  name="Losses"
                  data={result.losses}
                  fill="#f87171"
                  fillOpacity={0.65}
                  r={4}
                />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {totalPoints > 0 && (
        <>
          {/* Insight line */}
          {result.wins.length > 0 && result.losses.length > 0 && (() => {
            const wD = result.avgWinDurationH
            const lD = result.avgLossDurationH
            const longer = wD >= lD ? "Wins" : "Losses"
            const ratio = wD >= lD
              ? (lD > 0 ? (wD / lD).toFixed(1) : "∞")
              : (wD > 0 ? (lD / wD).toFixed(1) : "∞")
            const insight = wD >= lD
              ? `Winning trades are held ${ratio}× longer on average (${fmtDuration(wD)} vs ${fmtDuration(lD)}). You let profits run.`
              : `Losing trades are held ${ratio}× longer on average (${fmtDuration(lD)} vs ${fmtDuration(wD)}). Consider cutting losses faster.`
            return (
              <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${longer === "Wins" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300" : "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300"}`}>
                <span>{insight}</span>
              </div>
            )
          })()}

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            <Card className="text-center">
              <CardContent className="pt-4 pb-3 px-3">
                <p className="text-xs text-muted-foreground">Wins</p>
                <p className="mt-0.5 text-sm font-semibold text-emerald-500">{result.wins.length}</p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="pt-4 pb-3 px-3">
                <p className="text-xs text-muted-foreground">Losses</p>
                <p className="mt-0.5 text-sm font-semibold text-red-500">{result.losses.length}</p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="pt-4 pb-3 px-3">
                <p className="text-xs text-muted-foreground">Avg win duration</p>
                <p className="mt-0.5 text-sm font-semibold text-emerald-500">{fmtDuration(result.avgWinDurationH)}</p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="pt-4 pb-3 px-3">
                <p className="text-xs text-muted-foreground">Avg loss duration</p>
                <p className="mt-0.5 text-sm font-semibold text-red-500">{fmtDuration(result.avgLossDurationH)}</p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="pt-4 pb-3 px-3">
                <p className="text-xs text-muted-foreground">Avg win PnL</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-500">+{fmt(result.avgWinPnl)}</p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="pt-4 pb-3 px-3">
                <p className="text-xs text-muted-foreground">Avg loss PnL</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-red-500">{fmt(result.avgLossPnl)}</p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </main>
  )
}
