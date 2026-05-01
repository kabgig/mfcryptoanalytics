'use client'

import { useState, useCallback, useRef, useMemo } from 'react'
import { Upload, X, FileText, CheckCircle, AlertCircle, Loader2, CloudUpload } from 'lucide-react'
import { parseJupiterCsv } from '@/lib/exchanges/adapters/jupiter/parser'
import { computeStats } from '@/lib/services/statsService'
import { StatsBar } from '@/components/dashboard/StatsBar'
import { PnlChart } from '@/components/dashboard/PnlChart'
import { TradesTable } from '@/components/dashboard/TradesTable'
import { useUserStore } from '@/lib/store/userStore'
import type { Trade } from '@/types'

interface ImportBatch {
  fileName: string
  newCount: number
  dupCount: number
}

type SaveStatus =
  | { type: 'idle' }
  | { type: 'checking' }
  | { type: 'ready'; alreadySaved: number }
  | { type: 'saving' }
  | { type: 'done'; saved: number; skipped: number }
  | { type: 'error'; message: string }

export function JupiterImportView() {
  const telegramId = useUserStore((s) => s.telegramId)

  // Core trade map — key = tx id, deduped across all imports
  const [tradeMap, setTradeMap] = useState<Map<string, Trade>>(new Map())
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ type: 'idle' })
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const trades = useMemo(() => Array.from(tradeMap.values()), [tradeMap])
  const stats = useMemo(() => computeStats(trades), [trades])

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) return

    const text = await file.text()
    const { trades: parsed, skippedRows } = parseJupiterCsv(text)

    setTradeMap((prev) => {
      const next = new Map(prev)
      let newCount = 0
      let dupCount = 0
      for (const t of parsed) {
        if (next.has(t.id)) {
          dupCount++
        } else {
          next.set(t.id, t)
          newCount++
        }
      }
      setBatches((b) => [...b, { fileName: file.name, newCount, dupCount: dupCount + skippedRows }])
      return next
    })

    // Reset save status when new trades are added
    setSaveStatus({ type: 'idle' })
  }, [])

  const handleFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files)
    list.forEach(processFile)
  }, [processFile])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files)
    e.target.value = '' // allow re-selecting same file
  }

  const handleClear = () => {
    setTradeMap(new Map())
    setBatches([])
    setSaveStatus({ type: 'idle' })
  }

  const handleCheckAndSave = async () => {
    if (!telegramId || trades.length === 0) return

    const ids = trades.map((t) => t.id)

    // Step 1: check which IDs are already saved
    setSaveStatus({ type: 'checking' })
    try {
      const res = await fetch('/api/import/check-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId, ids }),
      })
      const { existingIds, error } = await res.json()
      if (error) throw new Error(error)

      const alreadySaved: number = existingIds.length
      setSaveStatus({ type: 'ready', alreadySaved })
    } catch (err) {
      setSaveStatus({ type: 'error', message: String(err) })
    }
  }

  const handleSave = async () => {
    if (!telegramId || trades.length === 0) return

    setSaveStatus({ type: 'saving' })
    try {
      const res = await fetch('/api/trades-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId,
          exchange: 'Jupiter Perps',
          trades,
          skipExisting: true,
        }),
      })
      const { saved, error } = await res.json()
      if (error) throw new Error(error)
      const skipped = trades.length - (saved ?? 0)
      setSaveStatus({ type: 'done', saved: saved ?? 0, skipped })
    } catch (err) {
      setSaveStatus({ type: 'error', message: String(err) })
    }
  }

  const hasData = trades.length > 0

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Import — Jupiter Perps</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload your trade history CSV exported from{' '}
          <a
            href="https://jup.ag/perps"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Jupiter Perps
          </a>
          . You can upload multiple files — duplicates are detected automatically.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors
          ${dragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50 hover:bg-accent/30'
          }`}
      >
        <CloudUpload className={`h-10 w-10 ${dragging ? 'text-primary' : 'text-muted-foreground'}`} />
        <div className="text-center">
          <p className="text-sm font-medium">
            {dragging ? 'Drop to import' : 'Drag & drop CSV files here'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          multiple
          className="hidden"
          onChange={onFileInput}
        />
      </div>

      {/* Batch log */}
      {batches.length > 0 && (
        <div className="space-y-1.5">
          {batches.map((b, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="font-medium truncate max-w-xs">{b.fileName}</span>
              <span className="text-emerald-500">+{b.newCount} new</span>
              {b.dupCount > 0 && (
                <span className="text-muted-foreground">{b.dupCount} skipped</span>
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {trades.length} unique trades total
          </p>
        </div>
      )}

      {/* Analytics preview */}
      {hasData && (
        <>
          <StatsBar stats={stats} />
          <PnlChart chartData={stats.chartData} />
          <TradesTable trades={trades} />

          {/* Save / Clear controls */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            {telegramId ? (
              <>
                {saveStatus.type === 'idle' && (
                  <button
                    onClick={handleCheckAndSave}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
                  >
                    <CloudUpload className="h-4 w-4" />
                    Save to account
                  </button>
                )}

                {saveStatus.type === 'checking' && (
                  <button disabled className="inline-flex items-center gap-2 rounded-md bg-primary/70 px-4 py-2 text-sm font-medium text-primary-foreground cursor-not-allowed">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking…
                  </button>
                )}

                {saveStatus.type === 'ready' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={handleSave}
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
                    >
                      <CloudUpload className="h-4 w-4" />
                      Confirm save
                    </button>
                    <span className="text-sm text-muted-foreground">
                      {saveStatus.alreadySaved > 0
                        ? `${saveStatus.alreadySaved} of ${trades.length} already in your account — only new trades will be added`
                        : `${trades.length} new trades will be saved`}
                    </span>
                  </div>
                )}

                {saveStatus.type === 'saving' && (
                  <button disabled className="inline-flex items-center gap-2 rounded-md bg-primary/70 px-4 py-2 text-sm font-medium text-primary-foreground cursor-not-allowed">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </button>
                )}

                {saveStatus.type === 'done' && (
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>
                      <span className="text-emerald-500 font-medium">{saveStatus.saved} saved</span>
                      {saveStatus.skipped > 0 && (
                        <span className="text-muted-foreground">, {saveStatus.skipped} already existed</span>
                      )}
                    </span>
                  </div>
                )}

                {saveStatus.type === 'error' && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {saveStatus.message}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Log in via Telegram to save trades to your account.
              </p>
            )}

            <button
              onClick={handleClear}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              <X className="h-4 w-4" />
              Clear
            </button>
          </div>
        </>
      )}
    </main>
  )
}
