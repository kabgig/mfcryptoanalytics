"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useUserStore } from "@/lib/store/userStore"
import { computeHourlyPnl, HOUR_NAMES } from "@/lib/services/hmonService"
import { LandingPage } from "@/components/home/LandingPage"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InfoTooltip } from "@/components/ui/tooltip"
import { RefreshCw, TriangleAlert } from "lucide-react"
import type { Trade } from "@/types"
import { fetchFuturesTrades as fetchBinanceFutures } from "@/lib/exchanges/adapters/binance/futures"
import { fetchFuturesTrades as fetchBybitFutures } from "@/lib/exchanges/adapters/bybit/futures"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

// 24 distinct colours cycling through the visible spectrum
const HOUR_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#10b981", "#14b8a6",
  "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1",
  "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
  "#f43f5e", "#fb923c", "#fbbf24", "#a3e635",
  "#34d399", "#22d3ee", "#60a5fa", "#c084fc",
]

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

// Custom tooltip — only shows hours with a non-zero value to keep it readable
function HMonTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { color: string; name: string; value: number }[]
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  const visible = payload.filter((e) => e.value !== 0)
  if (!visible.length) return null
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-md max-h-64 overflow-y-auto">
      <p className="mb-1 font-medium text-muted-foreground">{label}</p>
      {visible.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-foreground">{entry.name}</span>
          <span className={`ml-auto font-mono font-medium ${entry.value >= 0 ? "text-emerald-500" : "text-red-500"}`}>
            {entry.value >= 0 ? "+" : ""}
            {entry.value.toLocaleString("en-US", { style: "currency", currency: "USD" })}
          </span>
        </div>
      ))}
    </div>
  )
}

export function HMonView() {
  const telegramId = useUserStore((s) => s.telegramId)
  const apiKeys = useUserStore((s) => s.apiKeys)

  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(false)
  const [loadedExchanges, setLoadedExchanges] = useState<string[]>([])
  const [exchangeErrors, setExchangeErrors] = useState<Record<string, string>>({})
  const [period, setPeriod] = useState<PeriodLabel>("3m")
  const [timeField, setTimeField] = useState<"closeTime" | "openTime">("openTime")

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

  const hasAnyKey = buildExchangeConfigs().length > 0
  const errorEntries = Object.entries(exchangeErrors)

  const filteredTrades = useMemo(() => {
    const days = PERIODS.find((p) => p.label === period)?.days ?? 90
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    return trades.filter((t) => new Date(t.closeTime).getTime() >= cutoff)
  }, [trades, period])

  const chartData = useMemo(
    () => computeHourlyPnl(filteredTrades, timeField),
    [filteredTrades, timeField]
  )

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

      {errorEntries.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-red-400/50 bg-red-400/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {errorEntries.map(([name, msg]) => (
            <span key={name}><strong>{name}:</strong> {msg}</span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight">Hourly PnL Monitor</h1>
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

      {/* Time field toggle */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          Group by:
          <InfoTooltip
            content={
              <>
                <strong>Close time</strong> — buckets each trade by the hour it was <em>closed</em>. Useful for seeing when your exits tend to be profitable or unprofitable.
                <br /><br />
                <strong>Open time</strong> — buckets each trade by the hour it was <em>opened</em>. Useful for seeing which entry hours lead to the best outcomes.
              </>
            }
          />
        </span>
        <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
          {(["closeTime", "openTime"] as const).map((field) => (
            <button
              key={field}
              onClick={() => setTimeField(field)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                timeField === field
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {field === "closeTime" ? "Close time" : "Open time"}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cumulative PnL by Hour of Day (UTC)</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each line shows the running total PnL for trades that{" "}
            {timeField === "closeTime" ? "closed" : "opened"} during that UTC hour.
            A line only steps on dates that have trades in its hour; it stays flat otherwise.
          </p>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 && !loading ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              No trade data available.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={380}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  className="fill-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${v}`}
                  className="fill-muted-foreground"
                />
                <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="4 4" />
                <Tooltip content={<HMonTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                  formatter={(value) => <span className="text-foreground">{value}</span>}
                />
                {HOUR_NAMES.map((hour, i) => (
                  <Line
                    key={hour}
                    type="stepAfter"
                    dataKey={hour}
                    stroke={HOUR_COLORS[i]}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {chartData.length > 0 && (() => {
        const last = chartData[chartData.length - 1]
        return (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12">
            {HOUR_NAMES.map((hour, i) => {
              const final = (last[hour] as number) ?? 0
              const positive = final >= 0
              return (
                <Card key={hour} className="text-center">
                  <CardContent className="pt-3 pb-2 px-2">
                    <div className="mb-1 h-2 w-2 rounded-full mx-auto" style={{ backgroundColor: HOUR_COLORS[i] }} />
                    <p className="text-xs font-medium text-muted-foreground">{hour}</p>
                    <p className={`mt-0.5 text-xs font-semibold tabular-nums ${positive ? "text-emerald-500" : "text-red-500"}`}>
                      {positive ? "+" : ""}
                      {final.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )
      })()}
    </main>
  )
}
