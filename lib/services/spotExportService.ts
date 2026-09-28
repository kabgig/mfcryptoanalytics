import { escapeCsvField } from "@/lib/services/exportService"
import { DUST, oversoldSells, sortEntries } from "@/lib/services/spotService"
import { EMPTY_SPOT_JOURNAL, serializeSpotTags } from "@/lib/services/spotJournalFields"
import type { SpotEntry } from "@/types/spot"

/**
 * Spot ledger export, built for analysing a DCA history in a spreadsheet or an
 * LLM chat. Same CSV conventions as the futures export (exportService.ts):
 * RFC 4180 escaping, raw numbers, CRLF, newest first.
 *
 * Each row is one entry plus the state of its ticker's position right after it,
 * replayed under the same average-cost rules as computeHolding: a SELL retires
 * cost at the current average and is clamped to what was held, and a sell that
 * takes the position flat (within DUST) resets the cost basis and closes the
 * DCA cycle.
 *
 * Columns are declared once in SPOT_EXPORT_COLUMNS — adding one is a single
 * line there, plus a field on SpotLedgerRow if it needs new replay state. Every
 * consumer reads by header name, never by position.
 */

export interface SpotLedgerRow {
  entry: SpotEntry
  /** Units the replay actually applied — a SELL is clamped to what was held. */
  qtyApplied: number
  /** SELL that sold more than was held at the time; null for a BUY. */
  oversold: boolean | null
  /** Position right after this entry. */
  positionQty: number
  costBasis: number
  /** Average entry before / after this entry, null while nothing is held. */
  avgEntryBefore: number | null
  avgEntryAfter: number | null
  /** Banked by this SELL at the average cost at sale time; null for a BUY. */
  realisedPnl: number | null
  realisedPnlPct: number | null
  /** Running realised PnL for this ticker, up to and including this entry. */
  cumRealisedPnl: number
  /** 1-based DCA cycle for this ticker; a cycle ends when a sell takes it flat. */
  cycle: number
  /** BUY price against the average before it (negative = bought below average). */
  priceVsAvgPct: number | null
  /** Whole days since the previous entry for the same ticker, null for its first. */
  daysSincePrevEntry: number | null
  currentPrice: number | null
  /** Current price against this entry's price, null without a price feed. */
  changeSinceEntryPct: number | null
}

const DAY_MS = 86_400_000

function dayDiff(later: string, earlier: string): number {
  return Math.round(
    (Date.parse(`${later.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${earlier.slice(0, 10)}T00:00:00Z`)) /
      DAY_MS
  )
}

/**
 * Enriched rows in replay order (oldest first). Pure, so every column is
 * unit-testable without a DOM.
 */
export function buildSpotLedger(
  entries: SpotEntry[],
  currentPrices: Record<string, number> = {}
): SpotLedgerRow[] {
  const oversold = oversoldSells(entries)
  const state = new Map<
    string,
    { qty: number; costBasis: number; realised: number; cycle: number; closed: boolean; lastAt: string | null }
  >()
  const out: SpotLedgerRow[] = []

  for (const e of sortEntries(entries)) {
    let s = state.get(e.ticker)
    if (!s) {
      s = { qty: 0, costBasis: 0, realised: 0, cycle: 1, closed: false, lastAt: null }
      state.set(e.ticker, s)
    }

    const avgEntryBefore = s.qty > DUST ? s.costBasis / s.qty : null
    let qtyApplied = e.qty
    let realisedPnl: number | null = null
    let realisedPnlPct: number | null = null
    let priceVsAvgPct: number | null = null

    if (e.side === "BUY") {
      // The first buy after a position went flat opens the next cycle.
      if (s.closed) {
        s.cycle += 1
        s.closed = false
      }
      if (avgEntryBefore != null) priceVsAvgPct = (e.price / avgEntryBefore - 1) * 100
      s.qty += e.qty
      s.costBasis += e.qty * e.price
    } else {
      const sold = Math.max(0, Math.min(e.qty, s.qty))
      qtyApplied = sold
      realisedPnl = 0
      if (sold > 0) {
        const avgAtSale = s.costBasis / s.qty
        realisedPnl = sold * (e.price - avgAtSale)
        if (avgAtSale > 0) realisedPnlPct = (e.price / avgAtSale - 1) * 100
        s.realised += realisedPnl
        s.qty -= sold
        s.costBasis -= sold * avgAtSale
        if (s.qty <= DUST) {
          s.qty = 0
          s.costBasis = 0
          s.closed = true
        }
      }
    }

    const currentPrice = currentPrices[e.ticker] ?? null
    out.push({
      entry: e,
      qtyApplied,
      oversold: e.side === "SELL" ? oversold.has(e.id) : null,
      positionQty: s.qty,
      costBasis: s.costBasis,
      avgEntryBefore,
      avgEntryAfter: s.qty > DUST ? s.costBasis / s.qty : null,
      realisedPnl,
      realisedPnlPct,
      cumRealisedPnl: s.realised,
      cycle: s.cycle,
      priceVsAvgPct,
      daysSincePrevEntry: s.lastAt == null ? null : dayDiff(e.tradedAt, s.lastAt),
      currentPrice,
      changeSinceEntryPct:
        currentPrice != null && e.price > 0 ? (currentPrice / e.price - 1) * 100 : null,
    })
    s.lastAt = e.tradedAt
  }

  return out
}

/**
 * Derived values go through 12 significant digits so float noise
 * (0.30000000000000004) does not reach the sheet, while sub-cent meme-coin
 * prices keep their precision. Stored qty and price are written as-is.
 */
function num(v: number | null): number | null {
  return v == null ? null : Number(v.toPrecision(12))
}

type Cell = string | number | null | undefined

const journalOf = (r: SpotLedgerRow) => r.entry.journal ?? EMPTY_SPOT_JOURNAL
const yesNo = (v: boolean | null) => (v == null ? null : v ? "yes" : "no")

export const SPOT_EXPORT_COLUMNS: readonly { header: string; value: (r: SpotLedgerRow) => Cell }[] = [
  { header: "tradedAt", value: (r) => r.entry.tradedAt },
  { header: "ticker", value: (r) => r.entry.ticker },
  { header: "side", value: (r) => r.entry.side },
  { header: "qty", value: (r) => r.entry.qty },
  { header: "price", value: (r) => r.entry.price },
  { header: "total", value: (r) => num(r.entry.qty * r.entry.price) },
  { header: "qtyApplied", value: (r) => num(r.qtyApplied) },
  { header: "oversold", value: (r) => yesNo(r.oversold) },
  { header: "positionQty", value: (r) => num(r.positionQty) },
  { header: "costBasis", value: (r) => num(r.costBasis) },
  { header: "avgEntryBefore", value: (r) => num(r.avgEntryBefore) },
  { header: "avgEntryAfter", value: (r) => num(r.avgEntryAfter) },
  { header: "realisedPnl", value: (r) => num(r.realisedPnl) },
  { header: "realisedPnlPct", value: (r) => num(r.realisedPnlPct) },
  { header: "cumRealisedPnl", value: (r) => num(r.cumRealisedPnl) },
  { header: "cycle", value: (r) => r.cycle },
  { header: "priceVsAvgPct", value: (r) => num(r.priceVsAvgPct) },
  { header: "daysSincePrevEntry", value: (r) => r.daysSincePrevEntry },
  { header: "currentPrice", value: (r) => r.currentPrice },
  { header: "changeSinceEntryPct", value: (r) => num(r.changeSinceEntryPct) },
  // The journal, last: what the user wrote by hand, next to what the maths says.
  // Tags are '|'-joined like the futures export; the note is the only cell that
  // may need quoting (commas, line breaks), which escapeCsvField handles.
  { header: "planned", value: (r) => yesNo(journalOf(r).planned) },
  { header: "why", value: (r) => serializeSpotTags(journalOf(r).why) },
  { header: "feeling", value: (r) => serializeSpotTags(journalOf(r).feeling) },
  { header: "note", value: (r) => journalOf(r).note },
]

function cell(value: Cell): string {
  if (value === null || value === undefined) return ""
  return escapeCsvField(String(value))
}

/** One CSV row per entry, newest first — the reverse of replay order. */
export function buildSpotCsv(
  entries: SpotEntry[],
  currentPrices: Record<string, number> = {}
): string {
  const rows = [SPOT_EXPORT_COLUMNS.map((c) => c.header).join(",")]
  for (const r of buildSpotLedger(entries, currentPrices).reverse()) {
    rows.push(SPOT_EXPORT_COLUMNS.map((c) => cell(c.value(r))).join(","))
  }
  // Trailing newline: some spreadsheet importers drop the final row without it.
  return rows.join("\r\n") + "\r\n"
}

/** e.g. `spot-2026-09-28.csv` — sits next to the trades export in a downloads folder. */
export function spotExportFilename(now: Date = new Date()): string {
  return `spot-${now.toISOString().slice(0, 10)}.csv`
}
