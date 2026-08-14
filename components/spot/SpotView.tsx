"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, TriangleAlert } from "lucide-react"
import { useUserStore } from "@/lib/store/userStore"
import { LandingPage } from "@/components/home/LandingPage"
import {
  buildAllocation,
  buildPortfolioSeries,
  computeHoldings,
  tickersOf,
} from "@/lib/services/spotService"
import type { SpotEntry } from "@/types/spot"
import { SpotAllocation } from "./SpotAllocation"
import { SpotDcaChart } from "./SpotDcaChart"
import { SpotEntriesTable } from "./SpotEntriesTable"
import { SpotEntryForm } from "./SpotEntryForm"
import { SpotPortfolioChart } from "./SpotPortfolioChart"
import { SpotSummary } from "./SpotSummary"

interface PricesResponse {
  history: Record<string, { day: string; close: number }[]>
  current: Record<string, number>
  unpriced: string[]
}

export function SpotView() {
  const telegramId = useUserStore((s) => s.telegramId)

  const [entries, setEntries] = useState<SpotEntry[]>([])
  const [symbols, setSymbols] = useState<string[]>([])
  const [prices, setPrices] = useState<PricesResponse>({
    history: {},
    current: {},
    unpriced: [],
  })
  const [loading, setLoading] = useState(true)
  const [pricesLoading, setPricesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const loadPrices = useCallback(async () => {
    if (!telegramId) return
    setPricesLoading(true)
    try {
      const res = await fetch(`/api/spot/prices?telegramId=${telegramId}`)
      if (res.ok) setPrices((await res.json()) as PricesResponse)
    } catch {
      // Prices are supplementary — cost basis still renders without them.
    } finally {
      setPricesLoading(false)
    }
  }, [telegramId])

  const loadEntries = useCallback(async () => {
    if (!telegramId) return
    try {
      const res = await fetch(`/api/spot/entries?telegramId=${telegramId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Could not load entries")
      setEntries(data.entries as SpotEntry[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load entries")
    }
  }, [telegramId])

  // Initial load: entries and the ticker list, then prices for what is held.
  // Signed-out renders LandingPage instead, so `loading` is never read there —
  // no need to clear it synchronously here.
  useEffect(() => {
    if (!telegramId) return
    let cancelled = false
    ;(async () => {
      await loadEntries()
      try {
        const res = await fetch("/api/spot/symbols")
        if (res.ok && !cancelled) setSymbols((await res.json()).tickers as string[])
      } catch {
        // Autocomplete degrades to free text; the API still validates.
      }
      if (!cancelled) setLoading(false)
      await loadPrices()
    })()
    return () => {
      cancelled = true
    }
  }, [telegramId, loadEntries, loadPrices])

  const addEntry = useCallback(
    async (e: {
      ticker: string
      side: "BUY" | "SELL"
      qty: number
      price: number
      tradedAt: string
    }): Promise<string | null> => {
      if (!telegramId) return "Not signed in"
      try {
        const res = await fetch("/api/spot/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegramId, ...e }),
        })
        const data = await res.json()
        if (!res.ok) return (data.error as string) ?? "Could not save entry"
        setEntries((prev) => [...prev, data.entry as SpotEntry])
        // A new ticker needs its history backfilled before the charts can draw it.
        void loadPrices()
        return null
      } catch {
        return "Could not save entry"
      }
    },
    [telegramId, loadPrices]
  )

  const deleteEntry = useCallback(
    async (id: string) => {
      if (!telegramId) return
      const res = await fetch(`/api/spot/entries?telegramId=${telegramId}&id=${id}`, {
        method: "DELETE",
      })
      if (res.ok) setEntries((prev) => prev.filter((e) => e.id !== id))
    },
    [telegramId]
  )

  const { history, current, unpriced } = prices

  const holdings = useMemo(() => computeHoldings(entries, current), [entries, current])
  const allocation = useMemo(() => buildAllocation(holdings), [holdings])
  const portfolio = useMemo(
    () => buildPortfolioSeries(entries, history, today),
    [entries, history, today]
  )
  const tickers = useMemo(() => tickersOf(entries), [entries])

  if (!telegramId) return <LandingPage />

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Spot</h1>
          <p className="text-sm text-muted-foreground">
            Manually tracked long-term DCA positions.
          </p>
        </div>
        <button
          onClick={loadPrices}
          disabled={pricesLoading}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${pricesLoading ? "animate-spin" : ""}`} />
          Refresh prices
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {unpriced.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          No price feed for {unpriced.join(", ")} — cost basis is tracked, market
          value is not.
        </div>
      )}

      <SpotEntryForm tickers={symbols} entries={entries} onAdd={addEntry} />

      {loading ? (
        <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
          Loading…
        </div>
      ) : (
        <>
          <SpotSummary holdings={holdings} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SpotPortfolioChart series={portfolio} />
            <SpotAllocation allocation={allocation} />
          </div>

          <SpotDcaChart
            entries={entries}
            tickers={tickers}
            history={history}
            today={today}
          />

          <SpotEntriesTable entries={entries} onDelete={deleteEntry} />
        </>
      )}
    </main>
  )
}
