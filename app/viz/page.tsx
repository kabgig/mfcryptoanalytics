'use client'

import { useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Shapes } from 'lucide-react'
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

  // Normalise against the highest abs PnL across all periods
  const maxAbsPnl = useMemo(() => {
    const values = PERIODS.map((p) => Math.abs(sumPnl(filterByPeriod(trades, p.days))))
    return Math.max(...values, 1)
  }, [trades])

  const pnlPositive = pnl >= 0
  const pnlFormatted = pnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">

      {/* Full-screen Three.js canvas */}
      <div className="absolute inset-0">
        {!loading && <PnLWireframe pnl={pnl} maxAbsPnl={maxAbsPnl} shapeId={shapeId} />}
      </div>

      {/* Top-left — back link + shape picker */}
      <div className="absolute top-5 left-5 z-10 flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-xs font-mono text-white/40 hover:text-white/80 transition-colors tracking-widest uppercase"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <Link
          href="/viz/shapes"
          className="flex items-center gap-1.5 text-xs font-mono text-white/30 hover:text-white/70 transition-colors tracking-widest uppercase"
        >
          <Shapes className="h-3.5 w-3.5" />
          Shapes
        </Link>
      </div>

      {/* Top-right — period selector */}
      <div className="absolute top-5 right-5 z-10 flex gap-1.5">
        {PERIODS.map((p) => (
          <button
            key={p.label}
            onClick={() => setPeriod(p.label)}
            className={`px-2.5 py-1 text-xs font-mono rounded transition-all ${
              period === p.label
                ? 'bg-white/15 text-white'
                : 'text-white/30 hover:text-white/60'
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
            <p
              className={`text-5xl sm:text-6xl font-bold font-mono tracking-tight tabular-nums transition-colors duration-700 ${
                pnlPositive ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {pnlPositive ? '+' : ''}{pnlFormatted}
            </p>
            <p className="mt-2 text-white/30 font-mono text-xs tracking-[0.25em] uppercase">
              {period} · {periodTrades.length} trade{periodTrades.length !== 1 ? 's' : ''}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
