"use client"

import { useState } from "react"
import { Trash2, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { SpotEntry } from "@/types/spot"
import { price, qty, usd } from "./format"

interface Props {
  entries: SpotEntry[]
  onDelete: (id: string) => Promise<void>
}

export function SpotEntriesTable({ entries, onDelete }: Props) {
  const [deleting, setDeleting] = useState<string | null>(null)

  // Newest first for reading, while the maths always replays oldest-first.
  const rows = [...entries].sort((a, b) => b.tradedAt.localeCompare(a.tradedAt))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          Entries{entries.length > 0 && ` (${entries.length})`}
        </CardTitle>
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
                  <th className="py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr
                    key={e.id}
                    data-testid="spot-entry-row"
                    className="border-b border-border/40 last:border-0"
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
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{qty(e.qty)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{price(e.price)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {usd(e.qty * e.price)}
                    </td>
                    <td className="py-2 text-right">
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
