'use client'

import { useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Shapes, Sun, Moon } from 'lucide-react'
import { useUserStore } from '@/lib/store/userStore'
import type { ClientApiKeys } from '@/lib/exchanges/client'
import type { Trade } from '@/types'
import { computeStats } from '@/lib/services/statsService'
import { Tooltip } from '@/components/ui/tooltip'

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
  const stats = useMemo(() => computeStats(periodTrades), [periodTrades])

  // ── Session PnL (Night/Morning/Afternoon/Evening) ─────────────────────────
  const SESSION_SLOTS: [string, number[]][] = [
    ['Night',     [0,1,2,3,4,5]],
    ['Morning',   [6,7,8,9,10,11]],
    ['Afternoon', [12,13,14,15,16,17]],
    ['Evening',   [18,19,20,21,22,23]],
  ]
  const sessionPnl = useMemo(() => {
    const map: Record<string, number> = { Night: 0, Morning: 0, Afternoon: 0, Evening: 0 }
    for (const t of periodTrades) {
      const h = parseInt(t.closeTime.slice(11, 13), 10)
      const name = SESSION_SLOTS.find(([, hrs]) => hrs.includes(h))?.[0] ?? 'Night'
      map[name] = (map[name] ?? 0) + t.pnl
    }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodTrades])

  // ── Weekday PnL ────────────────────────────────────────────────────────────
  const WD_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const weekdayPnl = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of periodTrades) {
      const d = new Date(t.closeTime.slice(0, 10) + 'T00:00:00')
      const wd = WD_NAMES[d.getDay()]
      map[wd] = (map[wd] ?? 0) + t.pnl
    }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodTrades])

  // ── Top-10 tickers by abs PnL ─────────────────────────────────────────────
  const tickerPnl = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of periodTrades) {
      map[t.ticker] = (map[t.ticker] ?? 0) + t.pnl
    }
    return Object.entries(map)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 20)
  }, [periodTrades])

  // ── Exchange PnL ──────────────────────────────────────────────────────────
  const exchangePnl = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of periodTrades) {
      map[t.exchange] = (map[t.exchange] ?? 0) + t.pnl
    }
    return Object.entries(map).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  }, [periodTrades])

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
    ? { bg: 'bg-black', text: 'text-white', textHover: 'hover:text-white', textDim: 'text-white', textDimHover: 'hover:text-white', periodActive: 'bg-white/15 text-white', periodInactive: 'text-white hover:text-white', pnl: pnlPositive ? 'text-emerald-400' : 'text-red-400', subtext: 'text-white' }
    : { bg: 'bg-white', text: 'text-black', textHover: 'hover:text-black', textDim: 'text-black', textDimHover: 'hover:text-black', periodActive: 'bg-black/10 text-black', periodInactive: 'text-black hover:text-black', pnl: pnlPositive ? 'text-emerald-700' : 'text-red-700', subtext: 'text-black' }

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

      {/* Left side — terminal trade feed */}
      {periodTrades.length > 0 && (
        <div className="absolute left-5 top-16 bottom-20 z-10 w-80 overflow-hidden select-none">
          <div className="h-full overflow-y-auto flex flex-col gap-[3px] pr-1 pointer-events-auto">
            {/* header */}
            <div className={`grid gap-2 font-mono text-[15px] tracking-[0.18em] uppercase mb-1 ${darkMode ? 'text-white/40' : 'text-black/40'}`} style={{gridTemplateColumns:'1fr 1fr 1.4fr 1fr'}}>
              <span>PNL</span>
              <span>TICKER</span>
              <span>EXCH</span>
              <span className="text-right">TIME</span>
            </div>
            {periodTrades.slice().sort((a, b) => new Date(b.closeTime).getTime() - new Date(a.closeTime).getTime()).map((t, i) => {
              const pos = t.pnl >= 0
              const ts  = new Date(t.closeTime)
              const timeStr = `${String(ts.getMonth()+1).padStart(2,'0')}/${String(ts.getDate()).padStart(2,'0')} ${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}`
              return (
                <div
                  key={t.id ?? i}
                  className={`grid gap-2 font-mono text-[17px] leading-tight tabular-nums ${
                    pos
                      ? darkMode ? 'text-emerald-400' : 'text-emerald-700'
                      : darkMode ? 'text-red-400'     : 'text-red-700'
                  }`} style={{gridTemplateColumns:'1fr 1fr 1.4fr 1fr'}}
                >
                  <span className="shrink-0">{pos ? '+' : ''}{t.pnl.toFixed(2)}</span>
                  <span className={`truncate tracking-wider ${darkMode ? 'text-white' : 'text-black'}`}>{t.ticker}</span>
                  <span className={`truncate ${darkMode ? 'text-white/70' : 'text-black/70'}`}>{t.exchange}</span>
                  <span className={`text-right text-[14px] ${darkMode ? 'text-white/50' : 'text-black/50'}`}>{timeStr}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Right side — terminal stats panel (two columns) */}
      {!loading && periodTrades.length > 0 && (() => {
        const pfDisplay  = stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : '∞'
        const rrrDisplay = stats.rrr          !== null ? `${stats.rrr.toFixed(2)}x`    : '∞'
        const ddDisplay  = stats.maxDrawdown.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
        const dim  = `font-mono text-[13px] tracking-[0.15em] uppercase ${darkMode ? 'text-white' : 'text-black'}`
        const head = `font-mono text-[11px] tracking-[0.22em] uppercase mb-1 ${darkMode ? 'text-white/50' : 'text-black/50'}`
        const val  = `font-mono text-[17px] font-semibold tabular-nums ${darkMode ? 'text-white' : 'text-black'}`
        const pval = (v: number) => v >= 0
          ? `font-mono text-[17px] font-semibold tabular-nums ${darkMode ? 'text-emerald-400' : 'text-emerald-700'}`
          : `font-mono text-[17px] font-semibold tabular-nums ${darkMode ? 'text-red-400' : 'text-red-700'}`
        const fmt  = (v: number) => (v >= 0 ? '+' : '') + v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
        const divider = <div className={`my-2 border-t ${darkMode ? 'border-white/10' : 'border-black/10'}`} />
        const SESSION_ORDER = ['Morning','Afternoon','Evening','Night'] as const
        const row = (label: string, v: string, cls: string, tip?: string) => (
          <div key={label} className="flex justify-between items-baseline gap-2 mb-0.5">
            {tip
              ? <Tooltip content={tip} side="top"><span className={`${dim} cursor-help`}>{label}</span></Tooltip>
              : <span className={dim}>{label}</span>}
            <span className={cls}>{v}</span>
          </div>
        )

        return (
          <div className="absolute right-5 top-16 bottom-20 z-10 flex gap-5 select-none pointer-events-auto">

            {/* Column 1: Metrics · Sessions · Weekdays */}
            <div className="w-48 h-full overflow-y-auto flex flex-col gap-[3px] pr-1">
              <div className={head}>METRICS · {period}</div>
              {row('WIN RATE',      `${stats.winRate.toFixed(1)}%`, val, 'Winning trades ÷ total trades')}
              {row('PROFIT FACTOR', pfDisplay,                       val, 'Gross profit ÷ gross loss. ∞ = no losing trades')}
              {row('RRR',           rrrDisplay,                      val, 'Avg win ÷ avg loss')}
              {row('TRADES',        String(stats.tradeCount),        val, 'Total closed trades in period')}
              {row('MAX DD', `-${ddDisplay}`, `font-mono text-[17px] font-semibold tabular-nums ${darkMode ? 'text-red-400' : 'text-red-600'}`, 'Largest peak-to-trough drop in cumulative PnL')}

              {divider}

              <div className={head}>SESSION PNL</div>
              {SESSION_ORDER.map((s) => row(s.toUpperCase(), fmt(sessionPnl[s] ?? 0), pval(sessionPnl[s] ?? 0)))}

              {divider}

              <div className={head}>WEEKDAY PNL</div>
              {WD_NAMES.map((wd) => row(wd.toUpperCase(), fmt(weekdayPnl[wd] ?? 0), pval(weekdayPnl[wd] ?? 0)))}
            </div>

            {/* Column 2: Top Tickers · By Exchange */}
            <div className="w-52 h-full overflow-y-auto flex flex-col gap-[3px] pr-1">
              <div className={head}>TOP TICKERS</div>
              {tickerPnl.map(([ticker, v]) => (
                <div key={ticker} className="flex justify-between items-baseline gap-2 mb-0.5">
                  <span className={`${dim} truncate max-w-[116px]`}>{ticker}</span>
                  <span className={pval(v)}>{fmt(v)}</span>
                </div>
              ))}

              {divider}

              <div className={head}>BY EXCHANGE</div>
              {exchangePnl.map(([ex, v]) => (
                <div key={ex} className="flex justify-between items-baseline gap-2 mb-0.5">
                  <span className={`${dim} truncate max-w-[116px]`}>{ex.toUpperCase()}</span>
                  <span className={pval(v)}>{fmt(v)}</span>
                </div>
              ))}
            </div>

          </div>
        )
      })()}

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
