'use client'

import { useState, useEffect } from 'react'
import { useUserStore } from '@/lib/store/userStore'
import { buildClientRegistry } from '@/lib/exchanges/client'
import { StatsBar } from '@/components/dashboard/StatsBar'
import { PnlChart } from '@/components/dashboard/PnlChart'
import { TradesTable } from '@/components/dashboard/TradesTable'
import { computeStats } from '@/lib/services/statsService'
import { LandingPage } from '@/components/home/LandingPage'
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
  const telegramId = useUserStore((s) => s.telegramId)
  const apiKeys = useUserStore((s) => s.apiKeys)

  const [trades, setTrades] = useState<Trade[]>([])
  const [loadedExchanges, setLoadedExchanges] = useState<string[]>([])
  const [exchangeErrors, setExchangeErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!telegramId) return
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    telegramId,
    apiKeys.binanceApiKey, apiKeys.binanceApiSecret,
    apiKeys.bybitApiKey, apiKeys.bybitApiSecret,
    apiKeys.bingxApiKey, apiKeys.bingxApiSecret,
    apiKeys.mexcApiKey, apiKeys.mexcApiSecret,
    apiKeys.okxApiKey, apiKeys.okxApiSecret, apiKeys.okxPassphrase,
  ])

  const stats = computeStats(trades)

  if (!telegramId) return <LandingPage />

  return (
    <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 space-y-6">
      {loading && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-600 dark:text-amber-400 shadow-sm">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          </span>
          <span className="font-medium">
            {loadedExchanges.length === 0
              ? 'Data is Loading…'
              : `Data is Loading… (${loadedExchanges.join(', ')} ready)`}
          </span>
        </div>
      )}
      <StatsBar stats={stats} />
      <PnlChart chartData={stats.chartData} />
      {Object.entries(exchangeErrors).length > 0 && (
        <div className="text-xs text-destructive space-y-1 border border-destructive/30 rounded p-3 bg-destructive/5">
          <p className="font-semibold">Exchange errors:</p>
          {Object.entries(exchangeErrors).map(([exchange, err]) => (
            <p key={exchange}><span className="font-medium">{exchange}:</span> {err}</p>
          ))}
        </div>
      )}
      <TradesTable trades={trades} />
    </main>
  )
}
