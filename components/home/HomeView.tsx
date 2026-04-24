'use client'

import { useState, useEffect } from 'react'
import { useUserStore } from '@/lib/store/userStore'
import { buildClientRegistry } from '@/lib/exchanges/client'
import { StatsBar } from '@/components/dashboard/StatsBar'
import { PnlChart } from '@/components/dashboard/PnlChart'
import { TradesTable } from '@/components/dashboard/TradesTable'
import { LandingPage } from '@/components/home/LandingPage'
import { computeStats } from '@/lib/services/statsService'
import type { Trade } from '@/types'

export function HomeView() {
  const walletAddress = useUserStore((s) => s.walletAddress)
  const apiKeys = useUserStore((s) => s.apiKeys)
  const [trades, setTrades] = useState<Trade[]>([])
  const [loadedExchanges, setLoadedExchanges] = useState<string[]>([])
  const [exchangeErrors, setExchangeErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!walletAddress) return

    const adapters = buildClientRegistry(apiKeys)
    if (adapters.length === 0) return

    let cancelled = false
    setTrades([])
    setLoadedExchanges([])
    setExchangeErrors({})
    setLoading(true)

    async function fetchAll() {
      for (const adapter of adapters) {
        if (cancelled) break
        try {
          const newTrades = await adapter.fetchTrades()
          if (cancelled) break
          setTrades((prev) => {
            const merged = [...prev, ...newTrades]
            merged.sort((a, b) => new Date(b.closeTime).getTime() - new Date(a.closeTime).getTime())
            return merged
          })
          setLoadedExchanges((prev) => [...prev, adapter.name])
        } catch (err) {
          if (!cancelled) {
            setExchangeErrors((prev) => ({ ...prev, [adapter.name]: String(err) }))
            setLoadedExchanges((prev) => [...prev, adapter.name])
          }
        }
      }
      if (!cancelled) setLoading(false)
    }

    fetchAll()
    return () => { cancelled = true }
  }, [walletAddress, apiKeys])

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
      {Object.entries(exchangeErrors).length > 0 && (
        <div className="text-xs text-destructive space-y-1 border border-destructive/30 rounded p-3 bg-destructive/5">
          <p className="font-semibold">Exchange errors:</p>
          {Object.entries(exchangeErrors).map(([exchange, err]) => (
            <p key={exchange}><span className="font-medium">{exchange}:</span> {err}</p>
          ))}
        </div>
      )}
    </main>
  )
}
