'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useParams, useSearchParams } from 'next/navigation'
import { Shapes, Sun, Moon, Menu, X } from 'lucide-react'
import Link from 'next/link'
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

function filterByPeriod(trades: Trade[], days: number): Trade[] {
  if (days === Infinity) return trades
  const cutoff = Date.now() - days * 86_400_000
  return trades.filter((t) => new Date(t.closeTime).getTime() >= cutoff)
}

function sumPnl(trades: Trade[]): number {
  return trades.reduce((s, t) => s + t.pnl, 0)
}

export default function VizSharePage() {
  const { token } = useParams<{ token: string }>()
  const searchParams = useSearchParams()
  const shapeId = searchParams.get('shape') ?? 'icosahedron'

  const [allTrades, setAllTrades] = useState<Trade[]>([])
  const [loading, setLoading]     = useState(true)
  const [notFound, setNotFound]   = useState(false)
  const [period, setPeriod]       = useState<PeriodLabel>('3m')
  const [darkMode, setDarkMode]   = useState(true)
  const [menuOpen, setMenuOpen]   = useState(false)

  // Load trades from share API — no auth required
  useEffect(() => {
    if (!token) return
    setLoading(true)
    fetch(`/api/share/${token}`)
      .then(async (res) => {
        if (res.status === 404) { setNotFound(true); return }
        const data = await res.json()
        setAllTrades((data.trades ?? []) as Trade[])
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [token])

  const periodTrades = useMemo(() => {
    const p = PERIODS.find((x) => x.label === period)!
    return filterByPeriod(allTrades, p.days)
  }, [allTrades, period])

  const pnl   = useMemo(() => sumPnl(periodTrades), [periodTrades])
  const stats = useMemo(() => computeStats(periodTrades), [periodTrades])

  // ── Session PnL ───────────────────────────────────────────────────────────
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

  // ── Weekday PnL ───────────────────────────────────────────────────────────
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

  // ── Top tickers ───────────────────────────────────────────────────────────
  const tickerPnl = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of periodTrades) map[t.ticker] = (map[t.ticker] ?? 0) + t.pnl
    return Object.entries(map)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 20)
  }, [periodTrades])

  // ── Exchange PnL ──────────────────────────────────────────────────────────
  const exchangePnl = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of periodTrades) map[t.exchange] = (map[t.exchange] ?? 0) + t.pnl
    return Object.entries(map).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  }, [periodTrades])

  // ── Reference PnL (trader-relative) ──────────────────────────────────────
  const refPnl = useMemo(() => {
    const WEEK_MS = 7 * 86_400_000
    const trades3m = filterByPeriod(allTrades, 90)
    if (trades3m.length === 0) return Math.max(Math.abs(pnl), 1)
    const now = trades3m.reduce((latest, t) => {
      const ts = new Date(t.closeTime).getTime()
      return ts > latest ? ts : latest
    }, 0)
    const buckets: number[] = []
    for (let w = 0; w < 13; w++) {
      const end = now - w * WEEK_MS
      const start = end - WEEK_MS
      const weekTrades = trades3m.filter((t) => {
        const ts = new Date(t.closeTime).getTime()
        return ts >= start && ts < end
      })
      if (weekTrades.length > 0) buckets.push(Math.abs(sumPnl(weekTrades)))
    }
    if (buckets.length === 0) return Math.max(Math.abs(pnl), 1)
    const weeklyAvg = buckets.reduce((a, b) => a + b, 0) / buckets.length
    const currentDays = PERIODS.find((p) => p.label === period)!.days
    return Math.max(weeklyAvg * (Math.min(currentDays, 365) / 7), 1)
  }, [allTrades, period, pnl])

  // ── Auto-scroll refs ──────────────────────────────────────────────────────
  const tradeScrollRef   = useRef<HTMLDivElement>(null)
  const tradeInnerRef    = useRef<HTMLDivElement>(null)
  const userScrollingRef = useRef(false)
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef           = useRef<number | null>(null)
  const offsetRef        = useRef(0)

  const onUserWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    userScrollingRef.current = true
    if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current)
    const inner = tradeInnerRef.current
    const outer = tradeScrollRef.current
    if (inner && outer) {
      const maxOffset = Math.max(0, inner.scrollHeight - outer.clientHeight)
      offsetRef.current = Math.max(0, Math.min(maxOffset, offsetRef.current + e.deltaY))
      inner.style.transform = `translateY(-${offsetRef.current}px)`
    }
    userScrollTimerRef.current = setTimeout(() => { userScrollingRef.current = false }, 2500)
  }, [])

  const setTradeScrollRef = useCallback((el: HTMLDivElement | null) => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    ;(tradeScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    if (!el) return
    const PX_PER_MS = 0.03
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(now - last, 50); last = now
      const inner = tradeInnerRef.current
      if (!userScrollingRef.current && inner) {
        const maxOffset = Math.max(0, inner.scrollHeight - el.clientHeight)
        if (maxOffset > 0) {
          offsetRef.current += PX_PER_MS * dt
          if (offsetRef.current >= maxOffset) offsetRef.current = 0
          inner.style.transform = `translateY(-${offsetRef.current}px)`
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const mobileScrollRef  = useRef<HTMLDivElement>(null)
  const mobileInnerRef   = useRef<HTMLDivElement>(null)
  const mobileOffsetRef  = useRef(0)
  const mobileRafRef     = useRef<number | null>(null)

  const setMobileScrollRef = useCallback((el: HTMLDivElement | null) => {
    if (mobileRafRef.current !== null) { cancelAnimationFrame(mobileRafRef.current); mobileRafRef.current = null }
    ;(mobileScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    if (!el) return
    const PX_PER_MS = 0.03
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(now - last, 50); last = now
      const inner = mobileInnerRef.current
      if (inner) {
        const maxOffset = Math.max(0, inner.scrollHeight - el.clientHeight)
        if (maxOffset > 0) {
          mobileOffsetRef.current += PX_PER_MS * dt
          if (mobileOffsetRef.current >= maxOffset) mobileOffsetRef.current = 0
          inner.style.transform = `translateY(-${mobileOffsetRef.current}px)`
        }
      }
      mobileRafRef.current = requestAnimationFrame(tick)
    }
    mobileRafRef.current = requestAnimationFrame(tick)
  }, [])

  const mobileStatsScrollRef = useRef<HTMLDivElement>(null)
  const mobileStatsInnerRef  = useRef<HTMLDivElement>(null)
  const mobileStatsOffsetRef = useRef(0)
  const mobileStatsRafRef    = useRef<number | null>(null)

  const setMobileStatsScrollRef = useCallback((el: HTMLDivElement | null) => {
    if (mobileStatsRafRef.current !== null) { cancelAnimationFrame(mobileStatsRafRef.current); mobileStatsRafRef.current = null }
    ;(mobileStatsScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    if (!el) return
    const PX_PER_MS = 0.03
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(now - last, 50); last = now
      const inner = mobileStatsInnerRef.current
      if (inner) {
        const maxOffset = Math.max(0, inner.scrollHeight - el.clientHeight)
        if (maxOffset > 0) {
          mobileStatsOffsetRef.current += PX_PER_MS * dt
          if (mobileStatsOffsetRef.current >= maxOffset) mobileStatsOffsetRef.current = 0
          inner.style.transform = `translateY(-${mobileStatsOffsetRef.current}px)`
        }
      }
      mobileStatsRafRef.current = requestAnimationFrame(tick)
    }
    mobileStatsRafRef.current = requestAnimationFrame(tick)
  }, [])

  const pnlPositive  = pnl >= 0
  const pnlFormatted = pnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  const ui = darkMode
    ? { bg: 'bg-black', text: 'text-white', textHover: 'hover:text-white', textDim: 'text-white', textDimHover: 'hover:text-white', periodActive: 'bg-white/15 text-white', periodInactive: 'text-white hover:text-white', pnl: pnlPositive ? 'text-emerald-400' : 'text-red-400', subtext: 'text-white' }
    : { bg: 'bg-white', text: 'text-black', textHover: 'hover:text-black', textDim: 'text-black', textDimHover: 'hover:text-black', periodActive: 'bg-black/10 text-black', periodInactive: 'text-black hover:text-black', pnl: pnlPositive ? 'text-emerald-700' : 'text-red-700', subtext: 'text-black' }

  if (!loading && notFound) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black text-white font-mono">
        <div className="text-center space-y-2">
          <p className="text-lg tracking-widest uppercase">Link not found</p>
          <p className="text-sm text-white/40">This share link may have been revoked or is invalid.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative w-screen h-screen ${ui.bg} overflow-hidden transition-colors duration-300`}>

      {/* Full-screen canvas */}
      <div className="absolute inset-0">
        {!loading && <PnLWireframe pnl={pnl} maxAbsPnl={refPnl} shapeId={shapeId} darkMode={darkMode} />}
      </div>

      {/* ── Desktop top bar ───────────────────────────────────────────── */}
      <div className="hidden md:flex absolute top-5 left-5 z-10 items-center gap-3">
        <span className={`text-sm font-semibold font-mono tracking-tight ${darkMode ? 'text-white' : 'text-black'}`}>MF Crypto Analytics</span>
        <span className={`${darkMode ? 'text-white/20' : 'text-black/20'}`}>·</span>
        <span className={`text-xs font-mono tracking-widest uppercase ${darkMode ? 'text-white/40' : 'text-black/40'}`}>Shared Viz</span>
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

      {/* Top-right — period selector (desktop) */}
      <div className="hidden md:flex absolute top-5 right-5 z-10 gap-1.5">
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

      {/* ── Mobile top bar ────────────────────────────────────────────── */}
      <div className="md:hidden absolute top-4 left-4 z-20">
        <span className={`text-[11px] font-semibold font-mono tracking-tight ${darkMode ? 'text-white/70' : 'text-black/70'}`}>MF Crypto Analytics</span>
      </div>
      <div className="md:hidden absolute top-4 right-4 z-20">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className={`flex items-center justify-center w-8 h-8 rounded ${ui.textDim} ${ui.textHover} transition-colors`}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {menuOpen && (
        <div className={`md:hidden absolute top-14 right-4 z-20 rounded-lg border ${
          darkMode ? 'bg-black/90 border-white/10' : 'bg-white/90 border-black/10'
        } backdrop-blur-sm shadow-xl py-2 min-w-[160px] flex flex-col`}>
          <div className="px-3 py-2 flex flex-row gap-1 flex-wrap">
            {PERIODS.map((p) => (
              <button
                key={p.label}
                onClick={() => { setPeriod(p.label); setMenuOpen(false) }}
                className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                  period === p.label
                    ? darkMode ? 'bg-white/15 text-white' : 'bg-black/10 text-black'
                    : darkMode ? 'text-white/50 hover:text-white' : 'text-black/50 hover:text-black'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className={`mx-3 my-1 h-px ${darkMode ? 'bg-white/10' : 'bg-black/10'}`} />
          <Link
            href="/viz/shapes"
            onClick={() => setMenuOpen(false)}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-mono tracking-widest uppercase transition-colors ${
              darkMode ? 'text-white/50 hover:text-white' : 'text-black/50 hover:text-black'
            }`}
          >
            <Shapes className="h-3.5 w-3.5" />
            Shapes
          </Link>
          <div className={`mx-3 my-1 h-px ${darkMode ? 'bg-white/10' : 'bg-black/10'}`} />
          <button
            onClick={() => { setDarkMode((d) => !d); setMenuOpen(false) }}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-mono tracking-widest uppercase transition-colors ${
              darkMode ? 'text-white/50 hover:text-white' : 'text-black/50 hover:text-black'
            }`}
          >
            {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {darkMode ? 'Light' : 'Dark'}
          </button>
        </div>
      )}

      {/* Left side — trade feed (desktop) */}
      {periodTrades.length > 0 && (
        <div className="hidden md:block absolute left-5 top-16 bottom-20 z-10 w-80 overflow-hidden select-none">
          <div ref={setTradeScrollRef} onWheel={onUserWheel} className="h-full overflow-hidden pointer-events-auto">
            <div ref={tradeInnerRef} className="flex flex-col gap-[3px] pr-1" style={{ willChange: 'transform' }}>
              <div className={`grid gap-2 font-mono text-[15px] tracking-[0.18em] uppercase mb-1 ${darkMode ? 'text-white/40' : 'text-black/40'}`} style={{ gridTemplateColumns: '1fr 1fr 1.4fr 1fr' }}>
                <span>PNL</span><span>TICKER</span><span>EXCH</span><span className="text-right">TIME</span>
              </div>
              {periodTrades.slice().sort((a, b) => new Date(b.closeTime).getTime() - new Date(a.closeTime).getTime()).map((t, i) => {
                const pos = t.pnl >= 0
                const ts  = new Date(t.closeTime)
                const timeStr = `${String(ts.getMonth()+1).padStart(2,'0')}/${String(ts.getDate()).padStart(2,'0')} ${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}`
                return (
                  <div key={t.id ?? i} className={`grid gap-2 font-mono text-[17px] leading-tight tabular-nums ${pos ? (darkMode ? 'text-emerald-400' : 'text-emerald-700') : (darkMode ? 'text-red-400' : 'text-red-700')}`} style={{ gridTemplateColumns: '1fr 1fr 1.4fr 1fr' }}>
                    <span className="shrink-0">{pos ? '+' : ''}{t.pnl.toFixed(2)}</span>
                    <span className={`truncate tracking-wider ${darkMode ? 'text-white' : 'text-black'}`}>{t.ticker}</span>
                    <span className={`truncate ${darkMode ? 'text-white/70' : 'text-black/70'}`}>{t.exchange}</span>
                    <span className={`text-right text-[14px] ${darkMode ? 'text-white/50' : 'text-black/50'}`}>{timeStr}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Left side — trade feed (mobile) */}
      {periodTrades.length > 0 && (
        <div className="md:hidden absolute left-3 top-16 bottom-28 z-10 w-32 overflow-hidden select-none">
          <div ref={setMobileScrollRef} className="h-full overflow-hidden">
            <div ref={mobileInnerRef} className="flex flex-col gap-[4px]" style={{ willChange: 'transform' }}>
              {periodTrades.slice().sort((a, b) => new Date(b.closeTime).getTime() - new Date(a.closeTime).getTime()).map((t, i) => {
                const pos = t.pnl >= 0
                return (
                  <div key={t.id ?? i} className="flex gap-2 font-mono text-[8px] leading-tight tabular-nums">
                    <span className={`shrink-0 ${pos ? (darkMode ? 'text-emerald-400' : 'text-emerald-700') : (darkMode ? 'text-red-400' : 'text-red-700')}`}>{pos ? '+' : ''}{t.pnl.toFixed(2)}</span>
                    <span className={`truncate tracking-wide ${darkMode ? 'text-white/70' : 'text-black/70'}`}>{t.ticker}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Right side — stats panels */}
      {!loading && periodTrades.length > 0 && (() => {
        const pfDisplay  = stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : '∞'
        const rrrDisplay = stats.rrr          !== null ? `${stats.rrr.toFixed(2)}x`    : '∞'
        const ddDisplay  = stats.maxDrawdown.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
        const dim     = `font-mono text-[17px] tracking-[0.15em] uppercase ${darkMode ? 'text-white' : 'text-black'}`
        const head    = `font-mono text-[15px] tracking-[0.22em] uppercase mb-1 ${darkMode ? 'text-white/50' : 'text-black/50'}`
        const val     = `font-mono text-[20px] font-semibold tabular-nums ${darkMode ? 'text-white' : 'text-black'}`
        const pval    = (v: number) => `font-mono text-[20px] font-semibold tabular-nums ${v >= 0 ? (darkMode ? 'text-emerald-400' : 'text-emerald-700') : (darkMode ? 'text-red-400' : 'text-red-700')}`
        const fmt     = (v: number) => (v >= 0 ? '+' : '') + v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
        const divider = <div className={`my-2 border-t ${darkMode ? 'border-white/10' : 'border-black/10'}`} />
        const SESSION_ORDER = ['Morning','Afternoon','Evening','Night'] as const
        const row = (label: string, v: string, cls: string, tip?: string) => (
          <div key={label} className="flex justify-between items-baseline gap-2 mb-0.5">
            {tip
              ? <Tooltip content={tip} side="bottom"><span className={`${dim} cursor-help`}>{label}</span></Tooltip>
              : <span className={dim}>{label}</span>}
            <span className={cls}>{v}</span>
          </div>
        )
        return (
          <div className="hidden md:flex absolute right-5 top-16 bottom-20 z-10 gap-5 select-none pointer-events-auto">
            {/* Column 1 */}
            <div className="w-48 h-full overflow-y-auto flex flex-col gap-[3px] pr-1">
              <Tooltip content="Win rate, profit factor, RRR, max drawdown and total trades for the selected period" side="bottom">
                <div className={`${head} cursor-help inline-block`}>METRICS · {period}</div>
              </Tooltip>
              {row('WIN RATE',      `${stats.winRate.toFixed(1)}%`, val, 'Winning trades ÷ total trades')}
              {row('PROFIT FACTOR', pfDisplay,                       val, 'Gross profit ÷ gross loss. ∞ = no losing trades')}
              {row('RRR',           rrrDisplay,                      val, 'Avg win ÷ avg loss')}
              {row('TRADES',        String(stats.tradeCount),        val, 'Total closed trades in period')}
              {row('MAX DD', `-${ddDisplay}`, `font-mono text-[20px] font-semibold tabular-nums ${darkMode ? 'text-red-400' : 'text-red-600'}`, 'Largest peak-to-trough drop in cumulative PnL')}
              {divider}
              <Tooltip content="Cumulative PnL grouped by time of day" side="bottom">
                <div className={`${head} cursor-help inline-block`}>SESSION PNL</div>
              </Tooltip>
              {SESSION_ORDER.map((s) => row(s.toUpperCase(), fmt(sessionPnl[s] ?? 0), pval(sessionPnl[s] ?? 0)))}
              {divider}
              <Tooltip content="Cumulative PnL grouped by day of the week" side="bottom">
                <div className={`${head} cursor-help inline-block`}>WEEKDAY PNL</div>
              </Tooltip>
              {WD_NAMES.map((wd) => row(wd.toUpperCase(), fmt(weekdayPnl[wd] ?? 0), pval(weekdayPnl[wd] ?? 0)))}
            </div>
            {/* Column 2 */}
            <div className="w-52 h-full overflow-y-auto flex flex-col gap-[3px] pr-1">
              <Tooltip content="Top 20 tickers ranked by absolute cumulative PnL" side="bottom">
                <div className={`${head} cursor-help inline-block`}>TOP TICKERS</div>
              </Tooltip>
              {tickerPnl.map(([ticker, v]) => (
                <div key={ticker} className="flex justify-between items-baseline gap-2 mb-0.5">
                  <span className={`${dim} truncate max-w-[116px]`}>{ticker}</span>
                  <span className={pval(v)}>{fmt(v)}</span>
                </div>
              ))}
              {divider}
              <Tooltip content="Cumulative PnL per exchange in the selected period" side="bottom">
                <div className={`${head} cursor-help inline-block`}>BY EXCHANGE</div>
              </Tooltip>
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

      {/* Mobile stats panel */}
      {!loading && periodTrades.length > 0 && (() => {
        const pfDisplay  = stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : '∞'
        const rrrDisplay = stats.rrr          !== null ? `${stats.rrr.toFixed(2)}x`    : '∞'
        const ddDisplay  = stats.maxDrawdown.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
        const mDim   = `font-mono text-[6px] tracking-[0.12em] uppercase ${darkMode ? 'text-white' : 'text-black'}`
        const mHead  = `font-mono text-[6px] tracking-[0.2em] uppercase mb-0.5 ${darkMode ? 'text-white/40' : 'text-black/40'}`
        const mVal   = `font-mono text-[6px] font-semibold tabular-nums ${darkMode ? 'text-white' : 'text-black'}`
        const mPval  = (v: number) => `font-mono text-[6px] font-semibold tabular-nums ${v >= 0 ? (darkMode ? 'text-emerald-400' : 'text-emerald-700') : (darkMode ? 'text-red-400' : 'text-red-700')}`
        const fmt    = (v: number) => (v >= 0 ? '+' : '') + v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
        const mDiv   = <div className={`my-1.5 border-t ${darkMode ? 'border-white/10' : 'border-black/10'}`} />
        const SESSION_ORDER = ['Morning','Afternoon','Evening','Night'] as const
        const mRow = (label: string, v: string, cls: string) => (
          <div key={label} className="flex justify-between items-baseline gap-0.5 mb-[1px]">
            <span className={mDim}>{label}</span><span className={cls}>{v}</span>
          </div>
        )
        return (
          <div className="md:hidden absolute right-3 top-16 bottom-28 z-10 w-28 overflow-hidden select-none">
            <div ref={setMobileStatsScrollRef} className="h-full overflow-hidden">
              <div ref={mobileStatsInnerRef} className="flex flex-col pr-0.5" style={{ willChange: 'transform' }}>
                <div className={mHead}>METRICS · {period}</div>
                {mRow('WIN RATE',    `${stats.winRate.toFixed(1)}%`, mVal)}
                {mRow('PROF FACTOR', pfDisplay,                      mVal)}
                {mRow('RRR',         rrrDisplay,                     mVal)}
                {mRow('TRADES',      String(stats.tradeCount),       mVal)}
                {mRow('MAX DD',      `-${ddDisplay}`,                `font-mono text-[6px] font-semibold tabular-nums ${darkMode ? 'text-red-400' : 'text-red-600'}`)}
                {mDiv}
                <div className={mHead}>SESSION PNL</div>
                {SESSION_ORDER.map((s) => mRow(s.toUpperCase(), fmt(sessionPnl[s] ?? 0), mPval(sessionPnl[s] ?? 0)))}
                {mDiv}
                <div className={mHead}>WEEKDAY PNL</div>
                {WD_NAMES.map((wd) => mRow(wd.toUpperCase(), fmt(weekdayPnl[wd] ?? 0), mPval(weekdayPnl[wd] ?? 0)))}
                {mDiv}
                <div className={mHead}>TOP TICKERS</div>
                {tickerPnl.map(([ticker, v]) => mRow(ticker, fmt(v), mPval(v)))}
                {mDiv}
                <div className={mHead}>BY EXCHANGE</div>
                {exchangePnl.map(([ex, v]) => mRow(ex.toUpperCase(), fmt(v), mPval(v)))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Bottom-center — PnL readout */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 text-center pointer-events-none">
        {loading ? (
          <p className="text-white/30 font-mono text-sm tracking-widest">LOADING…</p>
        ) : allTrades.length === 0 ? (
          <p className="text-white/30 font-mono text-sm tracking-widest">NO TRADES</p>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2 sm:gap-4">
              <p className={`font-mono text-[13px] sm:text-[25px] font-bold tracking-[0.18em] uppercase ${darkMode ? 'text-white/50' : 'text-black/40'}`}>PNL</p>
              <p className={`text-2xl sm:text-6xl font-bold font-mono tracking-tight tabular-nums transition-colors duration-700 ${ui.pnl}`}>
                {pnlPositive ? '+' : ''}{pnlFormatted}
              </p>
            </div>
            <p className={`mt-1 sm:mt-2 ${ui.subtext} font-mono text-[9px] sm:text-xs tracking-[0.25em] uppercase`}>
              {period} · {periodTrades.length} trade{periodTrades.length !== 1 ? 's' : ''}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
