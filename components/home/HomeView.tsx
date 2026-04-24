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

async function fetchViaProxy(
  exchange: string,
  apiKey: string,
  apiSecret: string
): Promise<Trade[]> {
  const res = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exchange, apiKey, apiSecret }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data.trades as Trade[]
}

export function HomeView() {
  const walletAddress = useUserStore((s) => s.walletAddress)
  const apiKeys = useUserStore((s) => s.apiKeys)
  const [trades, setTrades] = useState<Trade[]>([])
  const [loadedExchanges, setLoadedExchanges] = useState<string[]>([])
  const [exchangeErrors, setExchangeErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!walletAddress) return

    // Client-side adapters (Binance, Bybit, OKX — support browser CORS)
    const clientAdapters = buildClientRegistry({
      ...apiKeys,
      // Zero out the CORS-blocked exchanges so they don't appear in clientAdapters
      bingxApiKey: '',
      bingxApiSecret: '',
      mexcApiKey: '',
      mexcApiSecret: '',
    })

    // Proxied exchanges (BingX, MEXC — no browser CORS support)
    const proxied: Array<{ name: string; apiKey: string; apiSecret: string }> = []
    if (apiKeys.bingxApiKey && apiKeys.bingxApiSecret)
      proxied.push({ name: 'BingX', apiKey: apiKeys.bingxApiKey, apiSecret: apiKeys.bingxApiSecret })
    if (apiKeys.mexcApiKey && apiKeys.mexcApiSecret)
      proxied.push({ name: 'MEXC', apiKey: apiKeys.mexcApiKey, apiSecret: apiKeys.mexcApiSecret })

    if (clientAdapters.length === 0 && proxied.length === 0) return

    let cancelled = false
    setTrades([])
    setLoadedExchanges([])
    setExchangeErrors({})
    setLoading(true)

    function addTrades(newTrades: Trade[], name: string) {
      setTrades((prev) => {
        const merged = [...prev, ...newTrades]
        merged.sort((a, b) => new Date(b.closeTime).getTime() - new Date(a.closeTime).getTime())
        return merged
      })
      setLoadedExchanges((prev) => [...prev, name])
    }

    async function fetchAll() {
      // Run client-side and proxied fetches concurrently
      const clientPromises = clientAdapters.map(async (adapter) => {
        try {
          const newTrades = await adapter.fetchTrades()
          if (!cancelled) addTrades(newTrades, adapter.name)
        } catch (err) {
          if (!cancelled) {
            setExchangeErrors((prev) => ({ ...prev, [adapter.name]: String(err) }))
            setLoadedExchanges((prev) => [...prev, adapter.name])
          }
        }
      })

      const proxyPromises = proxied.map(async ({ name, apiKey, apiSecret }) => {
        try {
          const newTrades = await fetchViaProxy(name, apiKey, apiSecret)
          if (!cancelled) addTrades(newTrades, name)
        } catch (err) {
          if (!cancelled) {
            setExchangeErrors((prev) => ({ ...prev, [name]: String(err) }))
            setLoadedExchanges((prev) => [...prev, name])
          }
        }
      })

      await Promise.all([...clientPromises, ...proxyPromises])
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
