'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { StatsBar } from '@/components/dashboard/StatsBar'
import { PnlChart } from '@/components/dashboard/PnlChart'
import { TradesTable } from '@/components/dashboard/TradesTable'
import { computeStats } from '@/lib/services/statsService'
import type { Trade } from '@/types'
import type { StatsResult } from '@/types'

export default function SharePage() {
  const { token } = useParams<{ token: string }>()
  const [trades, setTrades] = useState<Trade[]>([])
  const [stats, setStats] = useState<StatsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    fetch(`/api/share/${token}`)
      .then(async (res) => {
        if (res.status === 404) { setNotFound(true); return }
        const data = await res.json()
        const t: Trade[] = data.trades ?? []
        setTrades(t)
        setStats(computeStats(t))
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [token])

  return (
    <div className="min-h-screen bg-background">
      {/* Minimal header — no auth controls, no name */}
      <header className="sticky top-0 z-50 w-full border-b border-border/30 bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:px-6">
          <span className="text-sm font-medium tracking-tight sm:text-lg">
            MF Crypto Analytics
          </span>
          <span className="ml-3 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
            Shared PnL Report
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-6">
        {loading && (
          <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
            Loading…
          </div>
        )}

        {!loading && notFound && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <p className="text-lg font-semibold">Link not found</p>
            <p className="text-sm text-muted-foreground">
              This share link may have been revoked or is invalid.
            </p>
          </div>
        )}

        {!loading && !notFound && stats && (
          <>
            <StatsBar stats={stats} />
            <PnlChart chartData={stats.chartData} trades={trades} />
            <TradesTable trades={trades} />
          </>
        )}
      </main>
    </div>
  )
}
