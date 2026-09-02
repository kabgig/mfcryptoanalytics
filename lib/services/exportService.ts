import { tradeKey } from "@/lib/db/trades"
import { resolveTrade } from "@/lib/services/overridesService"
import { serializeChoices } from "@/lib/services/journalFields"
import type { Trade, TradeNotesMap, TradeOverridesMap } from "@/types"

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
  "bias",
  "market",
  "positionSize",
  "pnl",
  "strategy",
  "timeframe",
  "killzone",
  "entry",
  "tp1",
  "tp2",
  "sl",
  "riskPct",
  "rr",
  "rulesOK",
  "exitReason",
  "mistake",
  "emotion",
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
 *
 * The journal columns carry what the user recorded by hand; `bias` is theirs or
 * the one derived from `side`, and `rr` theirs or the one computed from
 * entry/TP1/SL — the same resolution the app renders, so an export matches the
 * screen it came from. `side` itself stays the exchange's own answer.
 *
 * exitReason, mistake and emotion each hold a list, written into their one cell
 * '|'-separated — a comma would have forced the writer to quote the cell, and
 * this export is meant to land in a spreadsheet or an LLM without anything
 * having to unpick quoting first.
 *
 * This is the surface built for pasting into an LLM to hunt for patterns, which
 * is exactly what the journal fields are for, so all of them ship.
 */
export function buildTradesCsv(
  trades: Trade[],
  notes: TradeNotesMap = {},
  overrides: TradeOverridesMap = {}
): string {
  const rows = [EXPORT_COLUMNS.join(",")]

  for (const trade of trades) {
    const key = tradeKey(trade.exchange, trade.id)
    const t = resolveTrade(trade, overrides[key])
    const n = notes[key] ?? {}
    rows.push([
      cell(t.closeTime),
      cell(t.openTime),
      cell(t.exchange),
      cell(t.ticker),
      cell(t.side),
      cell(t.bias),
      cell(t.market),
      cell(t.positionSize),
      cell(t.pnl),
      cell(t.journal.strategy),
      cell(t.journal.timeframe),
      cell(t.journal.killzone),
      cell(t.journal.entry),
      cell(t.tp1),
      cell(t.tp2),
      cell(t.sl),
      cell(t.journal.riskPct),
      cell(t.rr),
      cell(t.journal.rulesOK === undefined ? undefined : t.journal.rulesOK ? "yes" : "no"),
      cell(serializeChoices(t.journal.exitReason ?? [])),
      cell(serializeChoices(t.journal.mistake ?? [])),
      cell(serializeChoices(t.journal.emotion ?? [])),
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
