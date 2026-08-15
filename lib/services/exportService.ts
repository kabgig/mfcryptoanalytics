import { tradeKey } from "@/lib/db/trades"
import type { Trade, TradeNotesMap } from "@/types"

/**
 * Trade history export, built for pasting into an LLM chat for pattern analysis.
 *
 * CSV rather than a real .xlsx: a genuine spreadsheet binary would need a new
 * dependency, and every tool that matters here (Excel, Sheets, Claude) reads CSV
 * natively. Journal notes are free text containing commas, quotes and newlines,
 * so the writer does full RFC 4180 escaping — the ad-hoc splitter in
 * lib/exchanges/adapters/jupiter/parser.ts explicitly does not handle quoting
 * and must never be pointed at this output.
 */

export const EXPORT_COLUMNS = [
  "closeTime",
  "openTime",
  "exchange",
  "ticker",
  "side",
  "market",
  "positionSize",
  "pnl",
  "tp",
  "sl",
  "noteBefore",
  "noteDuring",
  "noteAfter",
] as const

/** Wraps a field in quotes when it contains a delimiter, quote or newline. */
export function escapeCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  return escapeCsvField(String(value))
}

/**
 * One CSV row per trade, newest close first, with the journal notes joined in.
 * Numbers are written raw (no currency symbols or thousands separators) so a
 * spreadsheet — or an LLM — reads them as numbers rather than strings.
 */
export function buildTradesCsv(trades: Trade[], notes: TradeNotesMap = {}): string {
  const rows = [EXPORT_COLUMNS.join(",")]

  for (const t of trades) {
    const n = notes[tradeKey(t.exchange, t.id)] ?? {}
    rows.push([
      cell(t.closeTime),
      cell(t.openTime),
      cell(t.exchange),
      cell(t.ticker),
      cell(t.side),
      cell(t.market),
      cell(t.positionSize),
      cell(t.pnl),
      cell(t.tp),
      cell(t.sl),
      cell(n.before),
      cell(n.during),
      cell(n.after),
    ].join(","))
  }

  // Trailing newline: some spreadsheet importers drop the final row without it.
  return rows.join("\r\n") + "\r\n"
}

/** e.g. `trades-2026-08-15.csv` — stable and sortable in a downloads folder. */
export function exportFilename(now: Date = new Date()): string {
  return `trades-${now.toISOString().slice(0, 10)}.csv`
}

/**
 * Hands the CSV to the browser as a download. Split from buildTradesCsv so the
 * formatting stays unit-testable in Node, where there is no DOM.
 */
export function downloadCsv(csv: string, filename = exportFilename()): void {
  // The BOM makes Excel open UTF-8 tickers and notes correctly instead of
  // mangling them as Latin-1.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking synchronously races the browser's read of the blob: the click only
  // *starts* the download, so tearing the URL down in the same tick can truncate
  // or abort it. One tick later the download owns the data.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
