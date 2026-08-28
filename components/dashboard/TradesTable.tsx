"use client"

import type { Trade, TradeNotePhase, TradeNotesMap, TradeOverridesMap } from "@/types"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { motion, useInView } from "motion/react"
import { useRef } from "react"
import { X, RotateCcw, Download } from "lucide-react"
import { TradeJournal } from "@/components/dashboard/TradeJournal"
import { tradeKey } from "@/lib/db/trades"
import { buildTradesCsv, downloadCsv } from "@/lib/services/exportService"
import { resolveTrade, type ResolvedTrade } from "@/lib/services/overridesService"
import { BiasCell, type SaveOverride } from "@/components/dashboard/TradeOverrideCell"
import { TradeJournalButton } from "@/components/dashboard/TradeJournalForm"

interface TradesTableProps {
  trades: Trade[]
  /** When provided, each row gets a delete button. Omit for read-only tables. */
  onDelete?: (trade: Trade) => void
  /** Soft-deleted trades, shown only while `showDeleted` is true. */
  deletedTrades?: Trade[]
  onRestore?: (trade: Trade) => void
  showDeleted?: boolean
  /** When provided, the header gets a "show deleted" toggle. */
  onToggleDeleted?: (next: boolean) => void
  /**
   * Journal notes keyed by `tradeKey(exchange, id)`. Supplying `onSaveNote`
   * turns on the journal column — read-only tables (share links, import
   * previews) omit it and never render, or leak, a user's notes.
   */
  notes?: TradeNotesMap
  onSaveNote?: (trade: Trade, phase: TradeNotePhase, body: string) => Promise<void>
  /**
   * The user's journal entries keyed by `tradeKey(exchange, id)`. Always applied
   * when supplied; supplying `onSaveOverride` additionally turns on the Bias
   * picker and the 📋 journal form, so read-only tables (share links, import
   * previews) render plain values and never expose a journal.
   */
  overrides?: TradeOverridesMap
  onSaveOverride?: SaveOverride
  /** When true, the header gets a CSV export button. */
  exportable?: boolean
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function AnimatedRow({
  children,
  index,
  isProfit,
  isDeleted,
}: {
  children: React.ReactNode
  index: number
  isProfit: boolean
  isDeleted?: boolean
}) {
  const ref = useRef<HTMLTableRowElement>(null)
  const inView = useInView(ref, { once: true, margin: "0px 0px -40px 0px" })
  return (
    <motion.tr
      ref={ref}
      initial={{ opacity: 0, x: -12 }}
      animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.6) }}
      className={
        isDeleted
          ? "opacity-60 bg-muted/30 hover:bg-muted/60"
          : isProfit
            ? "bg-emerald-500/5 hover:bg-emerald-500/10"
            : "bg-red-500/5 hover:bg-red-500/10"
      }
    >
      {children}
    </motion.tr>
  )
}

export function TradesTable({
  trades,
  onDelete,
  deletedTrades = [],
  onRestore,
  showDeleted = false,
  onToggleDeleted,
  notes,
  onSaveNote,
  overrides,
  onSaveOverride,
  exportable = false,
}: TradesTableProps) {
  const tableRef = useRef<HTMLTableSectionElement>(null)
  const hasActions = Boolean(onDelete)
  const hasJournal = Boolean(onSaveNote)
  // Overrides are folded in once here rather than at each cell, so the rendered
  // rows and the CSV export can never disagree about which value won.
  const resolve = (trade: Trade): ResolvedTrade =>
    resolveTrade(trade, overrides?.[tradeKey(trade.exchange, trade.id)])
  // Revealed rows are merged into the chronological order rather than appended,
  // so a deleted trade shows up where the user left it instead of at the very
  // bottom of a long history.
  const rows: { trade: ResolvedTrade; deleted: boolean }[] = showDeleted
    ? [
        ...trades.map((trade) => ({ trade: resolve(trade), deleted: false })),
        ...deletedTrades.map((trade) => ({ trade: resolve(trade), deleted: true })),
      ].sort((a, b) => new Date(b.trade.closeTime).getTime() - new Date(a.trade.closeTime).getTime())
    : trades.map((trade) => ({ trade: resolve(trade), deleted: false }))

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">Trade History</CardTitle>
        <div className="flex items-center gap-2">
        {exportable && (
          <button
            type="button"
            // Exports exactly what is on screen — the same period filter and the
            // same deleted/not-deleted set the user is looking at.
            onClick={() => downloadCsv(buildTradesCsv(rows.map((r) => r.trade), notes, overrides))}
            disabled={rows.length === 0}
            title="Download visible trades and notes as CSV"
            data-testid="export-trades"
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        )}
        {onToggleDeleted && deletedTrades.length > 0 && (
          <button
            type="button"
            onClick={() => onToggleDeleted(!showDeleted)}
            aria-pressed={showDeleted}
            data-testid="toggle-deleted"
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              showDeleted
                ? "border-foreground/30 bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {showDeleted ? "Hide deleted" : `Show deleted (${deletedTrades.length})`}
          </button>
        )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto pl-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">PnL</TableHead>
                <TableHead className="w-24">Ticker</TableHead>
                <TableHead className="w-24">Exchange</TableHead>
                <TableHead className="text-right">Position Size</TableHead>
                <TableHead className="w-20">Bias</TableHead>
                <TableHead>Open Time</TableHead>
                <TableHead>Close Time</TableHead>
                {hasJournal && <TableHead className="w-28">Journal</TableHead>}
                {hasActions && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody ref={tableRef}>
              {rows.map(({ trade, deleted }, i) => {
                const isProfit = trade.pnl >= 0
                return (
                  <AnimatedRow
                    key={`${trade.exchange}|${trade.id}`}
                    index={i}
                    isProfit={isProfit}
                    isDeleted={deleted}
                  >
                    <TableCell
                      className={`text-right font-mono font-semibold ${
                        deleted
                          ? "text-muted-foreground line-through"
                          : isProfit
                            ? "text-emerald-500"
                            : "text-red-500"
                      }`}
                    >
                      {isProfit ? "+" : ""}
                      {trade.pnl.toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                      })}
                    </TableCell>
                    <TableCell className="w-24 max-w-[6rem] font-mono font-medium">
                      <span className="block truncate" title={trade.ticker}>{trade.ticker}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {trade.exchange}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {trade.positionSize === 0 ? "—" : trade.positionSize.toLocaleString("en-US")}
                    </TableCell>
                    <TableCell className="w-20 text-sm">
                      <BiasCell trade={trade} onSave={onSaveOverride} disabled={deleted} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(trade.openTime)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(trade.closeTime)}
                    </TableCell>
                    {hasJournal && (
                      <TableCell className="w-28">
                        <div className="flex items-center gap-0.5">
                          <TradeJournal
                            trade={trade}
                            notes={notes?.[tradeKey(trade.exchange, trade.id)] ?? {}}
                            onSave={onSaveNote!}
                            disabled={deleted}
                          />
                          <TradeJournalButton
                            trade={trade}
                            onSave={onSaveOverride}
                            disabled={deleted}
                          />
                        </div>
                      </TableCell>
                    )}
                    {hasActions && (
                      <TableCell className="w-10 pr-3">
                        {deleted ? (
                          onRestore && (
                            <button
                              type="button"
                              onClick={() => onRestore(trade)}
                              title="Restore trade"
                              aria-label={`Restore ${trade.ticker} trade`}
                              data-testid="restore-trade"
                              className="flex h-6 w-6 items-center justify-center rounded text-foreground/80 transition-colors hover:bg-emerald-500/15 hover:text-emerald-500"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() => onDelete!(trade)}
                            title="Delete trade"
                            aria-label={`Delete ${trade.ticker} trade`}
                            data-testid="delete-trade"
                            className="flex h-6 w-6 items-center justify-center rounded text-red-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </TableCell>
                    )}
                  </AnimatedRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
