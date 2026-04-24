'use client'

import { useState, useEffect } from 'react'
import { useUserStore } from '@/lib/store/userStore'
import { StatsBar } from '@/components/dashboard/StatsBar'
import { PnlChart } from '@/components/dashboard/PnlChart'
import { TradesTable } from '@/components/dashboard/TradesTable'
import { LandingPage } from '@/components/home/LandingPage'
import { computeStats } from '@/lib/services/statsService'
import type { Trade } from '@/types'

export function HomeView() {
  const walletAddress = useUserStore((s) => s.walletAddress)
  const [trades, setTrades] = useState<Trade[]>([])
  const [loadedExchanges, setLoadedExchanges] = useState<string[]>([])
  const [pendingExchanges, setPendingExchanges] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!walletAddress) return

    let cancelled = false
    setTrades([])
    setLoadedExchanges([])
    setPendingExchanges([])
    setLoading(true)

    async function fetchStream() {
      const res = await fetch('/api/trades')
      if (!res.body) return

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done || cancelled) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const { exchange, trades: newTrades }: { exchange: string; trades: Trade[] } = JSON.parse(line)
            setTrades((prev) => {
              const merged = [...prev, ...newTrades]
              merged.sort((a, b) => new Date(b.closeTime).getTime() - new Date(a.closeTime).getTime())
              return merged
            })
            setLoadedExchanges((prev) => [...prev, exchange])
            setPendingExchanges((prev) => prev.filter((e) => e !== exchange))
          } catch {
            // malformed line — skip
          }
        }
      }

      if (!cancelled) setLoading(false)
    }

    fetchStream()
    return () => { cancelled = true }
  }, [walletAddress])

  if (!walletAddress) return <LandingPage />

  const stats = computeStats(trades)

  return (
    <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 space-y-6">
      <StatsBar stats={stats} />
      <PnlChart chartData={stats.chartData} />
      <TradesTable trades={trades} />
      {loading && (
        <p className="text-sm text-muted-foreground text-center animate-pulse">
          {loadedExchanges.length === 0
            ? 'Loading trades…'
            : `Loaded: ${loadedExchanges.join(', ')} — fetching more…`}
        </p>
      )}
    </main>
  )
}
