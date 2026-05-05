'use client'

import { useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Shapes, Sun, Moon } from 'lucide-react'
import { useUserStore } from '@/lib/store/userStore'
import type { ClientApiKeys } from '@/lib/exchanges/client'
import type { Trade } from '@/types'

const PnLWireframe = dynamic(
  () => import('@/components/viz/PnLWireframe').then((m) => ({ default: m.PnLWireframe })),
  { ssr: false, loading: () => null }
)

const PERIODS = [
  { label: '1d',  days: 1 },
  { label: '1w',  days: 7 },
  { label: '1m',  days: 30 },
  { label: '3m',  days: 90 },
  { label: '6m',  days: 180 },
  { label: '1y',  days: 365 },
  { label: 'All', days: Infinity },
] as const

type PeriodLabel = typeof PERIODS[number]['label']

const EXCHANGE_KEY_MAP: Record<string, keyof ClientApiKeys> = {
  Binance: 'binanceApiKey',
  Bybit:   'bybitApiKey',
  BingX:   'bingxApiKey',
  MEXC:    'mexcApiKey',
  OKX:     'okxApiKey',
  Bitunix: 'bitunixApiKey',
  BYDFi:   'bydfiApiKey',
}

function filterByPeriod(trades: Trade[], days: number): Trade[] {
  if (days === Infinity) return trades
  const cutoff = Date.now() - days * 86_400_000
  return trades.filter((t) => new Date(t.closeTime).getTime() >= cutoff)
}

function sumPnl(trades: Trade[]): number {
  return trades.reduce((s, t) => s + t.pnl, 0)
}

export default function VizPage() {
  const searchParams = useSearchParams()
  const shapeId = searchParams.get('shape') ?? 'torus-knot-2-3'
  const telegramId  = useUserStore((s) => s.telegramId)
  const apiKeys     = useUserStore((s) => s.apiKeys)
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading]   = useState(true)
  const [period, setPeriod]     = useState<PeriodLabel>('1m')

  // Fetch all cached trades on mount
  useEffect(() => {
    if (!telegramId) { setLoading(false); return }

    const exchanges = [
      ...Object.entries(EXCHANGE_KEY_MAP)
        .filter(([, k]) => !!apiKeys[k])
        .map(([name]) => name),
      'Jupiter', // manual import — always try
    ]

    Promise.all(
      exchanges.map(async (exchange) => {
        try {
          const res = await fetch('/api/trades-cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramId, exchange }),
          })
          const data = await res.json()
          return data.fresh ? (data.trades as Trade[]) : []
        } catch {
          return []
        }
      })
    ).then((results) => {
      setTrades(results.flat())
      setLoading(false)
    })
  }, [telegramId, apiKeys])

  const periodTrades = useMemo(() => {
    const p = PERIODS.find((x) => x.label === period)!
    return filterByPeriod(trades, p.days)
  }, [trades, period])

  const pnl = useMemo(() => sumPnl(periodTrades), [periodTrades])

  // ── Trader-relative reference PnL ────────────────────────────────────────
  // Split the last 3 months into weekly buckets, compute the avg absolute
  // PnL per week, then scale it to the current period length.
  // Result: if current PnL > their own 3m weekly avg → glows bright;
  //         if below average → dim.  Traders with small PnL still get
  //         meaningful visualisation rather than being compared to a max.
  const refPnl = useMemo(() => {
    const WEEK_MS = 7 * 86_400_000
    const trades3m = filterByPeriod(trades, 90)
    if (trades3m.length === 0) return Math.max(Math.abs(pnl), 1)

    const now = Date.now()
    const buckets: number[] = []
    for (let w = 0; w < 13; w++) {
      const end   = now - w * WEEK_MS
      const start = end - WEEK_MS
      const weekTrades = trades3m.filter((t) => {
        const ts = new Date(t.closeTime).getTime()
        return ts >= start && ts < end
      })
      if (weekTrades.length > 0) {
        buckets.push(Math.abs(sumPnl(weekTrades)))
      }
    }

    if (buckets.length === 0) return Math.max(Math.abs(pnl), 1)
    const weeklyAvg = buckets.reduce((a, b) => a + b, 0) / buckets.length

    // Scale weekly avg to the current period's length
    const currentDays = PERIODS.find((p) => p.label === period)!.days
    const scaled = weeklyAvg * (Math.min(currentDays, 365) / 7)
    return Math.max(scaled, 1)
  }, [trades, period, pnl])

  const [darkMode, setDarkMode] = useState(true)

  const pnlPositive = pnl >= 0
  const pnlFormatted = pnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  const ui = darkMode
    ? { bg: 'bg-black', text: 'text-white/40', textHover: 'hover:text-white/80', textDim: 'text-white/30', textDimHover: 'hover:text-white/70', periodActive: 'bg-white/15 text-white', periodInactive: 'text-white/30 hover:text-white/60', pnl: pnlPositive ? 'text-emerald-400' : 'text-red-400', subtext: 'text-white/30' }
    : { bg: 'bg-white', text: 'text-black/50', textHover: 'hover:text-black/90', textDim: 'text-black/40', textDimHover: 'hover:text-black/70', periodActive: 'bg-black/10 text-black', periodInactive: 'text-black/30 hover:text-black/60', pnl: pnlPositive ? 'text-emerald-700' : 'text-red-700', subtext: 'text-black/30' }

  return (
    <div className={`relative w-screen h-screen ${ui.bg} overflow-hidden transition-colors duration-300`}>

      {/* Full-screen Three.js canvas */}
      <div className="absolute inset-0">
        {!loading && <PnLWireframe pnl={pnl} maxAbsPnl={refPnl} shapeId={shapeId} darkMode={darkMode} />}
      </div>

      {/* Top-left — back link + shape picker */}
      <div className="absolute top-5 left-5 z-10 flex items-center gap-3">
        <Link
          href="/"
          className={`flex items-center gap-1.5 text-xs font-mono ${ui.text} ${ui.textHover} transition-colors tracking-widest uppercase`}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <Link
          href="/viz/shapes"
          className={`flex items-center gap-1.5 text-xs font-mono ${ui.textDim} ${ui.textDimHover} transition-colors tracking-widest uppercase`}
        >
          <Shapes className="h-3.5 w-3.5" />
          Shapes
        </Link>
        <button
          onClick={() => setDarkMode((d) => !d)}
          className={`flex items-center justify-center w-7 h-7 rounded-full ${ui.textDim} ${ui.textHover} transition-colors`}
          title="Toggle theme"
        >
          {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Top-right — period selector */}
      <div className="absolute top-5 right-5 z-10 flex gap-1.5">
        {PERIODS.map((p) => (
          <button
            key={p.label}
            onClick={() => setPeriod(p.label)}
            className={`px-2.5 py-1 text-xs font-mono rounded transition-all ${
              period === p.label ? ui.periodActive : ui.periodInactive
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Bottom-center — PnL readout */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 text-center pointer-events-none">
        {loading ? (
          <p className="text-white/30 font-mono text-sm tracking-widest">LOADING…</p>
        ) : trades.length === 0 ? (
          <p className="text-white/30 font-mono text-sm tracking-widest">
            NO CACHED TRADES — LOAD FROM DASHBOARD FIRST
          </p>
        ) : (
          <>
            <p className={`text-5xl sm:text-6xl font-bold font-mono tracking-tight tabular-nums transition-colors duration-700 ${ui.pnl}`}
            >
              {pnlPositive ? '+' : ''}{pnlFormatted}
            </p>
            <p className={`mt-2 ${ui.subtext} font-mono text-xs tracking-[0.25em] uppercase`}>
              {period} · {periodTrades.length} trade{periodTrades.length !== 1 ? 's' : ''}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
