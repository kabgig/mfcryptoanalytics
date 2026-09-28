"use client"

import { useMemo, useState } from "react"
import { Trash2, Loader2, Pencil, TriangleAlert, Download } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { downloadCsv } from "@/lib/services/exportService"
import { buildSpotCsv, spotExportFilename } from "@/lib/services/spotExportService"
import { oversoldSells } from "@/lib/services/spotService"
import type { SpotEntry } from "@/types/spot"
import { price, qty, usd } from "./format"

interface Props {
  entries: SpotEntry[]
  /** The entry currently loaded into the form, highlighted in the table. */
  editingId: string | null
  onEdit: (entry: SpotEntry) => void
  onDelete: (id: string) => Promise<void>
  /** Latest price per ticker, for the export's "compared with today" columns. */
  currentPrices?: Record<string, number>
}

export function SpotEntriesTable({ entries, editingId, onEdit, onDelete, currentPrices }: Props) {
  const [deleting, setDeleting] = useState<string | null>(null)

  // SELLs stranded by a later edit or delete of the BUY that funded them.
  const oversold = useMemo(() => oversoldSells(entries), [entries])

  // Newest first for reading, while the maths always replays oldest-first.
  const rows = [...entries].sort((a, b) => b.tradedAt.localeCompare(a.tradedAt))

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-3">
        <CardTitle className="text-sm font-medium">
          Entries{entries.length > 0 && ` (${entries.length})`}
        </CardTitle>
        <button
          type="button"
          onClick={() => downloadCsv(buildSpotCsv(entries, currentPrices), spotExportFilename())}
          disabled={entries.length === 0}
          title="Download every entry with position and PnL columns as CSV"
          data-testid="export-spot"
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No entries yet. Add your first buy above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-medium">Date</th>
                  <th className="py-2 pr-3 text-left font-medium">Ticker</th>
                  <th className="py-2 pr-3 text-left font-medium">Side</th>
                  <th className="py-2 pr-3 text-right font-medium">Qty</th>
                  <th className="py-2 pr-3 text-right font-medium">Price</th>
                  <th className="py-2 pr-3 text-right font-medium">Total</th>
                  <th className="py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr
                    key={e.id}
                    data-testid="spot-entry-row"
                    data-editing={e.id === editingId ? "true" : undefined}
                    className={`border-b border-border/40 last:border-0 ${
                      e.id === editingId ? "bg-accent/60" : ""
                    }`}
                  >
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {e.tradedAt.slice(0, 10)}
                    </td>
                    <td className="py-2 pr-3 font-medium">{e.ticker}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          e.side === "BUY"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400"
                        }`}
                      >
                        {e.side}
                      </span>
                      {oversold.has(e.id) && (
                        <span
                          data-testid="spot-oversold"
                          className="ml-1.5 inline-flex items-center gap-1 whitespace-nowrap text-xs text-amber-600 dark:text-amber-400"
                          title={`Sells ${qty(e.qty)} ${e.ticker}, but only ${qty(
                            oversold.get(e.id) ?? 0
                          )} was held on this date. Edit or delete it to fix.`}
                        >
                          <TriangleAlert className="h-3.5 w-3.5" />
                          only {qty(oversold.get(e.id) ?? 0)} held
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{qty(e.qty)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{price(e.price)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {usd(e.qty * e.price)}
                    </td>
                    <td className="py-2 whitespace-nowrap text-right">
                      <button
                        data-testid="spot-edit-entry"
                        aria-label={`Edit ${e.side} ${e.ticker} entry`}
                        onClick={() => onEdit(e)}
                        disabled={deleting === e.id}
                        className="inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                        title="Edit entry"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        data-testid="spot-delete-entry"
                        aria-label={`Delete ${e.side} ${e.ticker} entry`}
                        onClick={async () => {
                          setDeleting(e.id)
                          await onDelete(e.id)
                          setDeleting(null)
                        }}
                        disabled={deleting === e.id}
                        className="inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-red-600 disabled:opacity-50"
                        title="Delete entry"
                      >
                        {deleting === e.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
