import { escapeCsvField } from "@/lib/services/exportService"
import {
  DUST,
  buildAllocation,
  computeHoldings,
  computeTotals,
  oversoldSells,
  sortEntries,
} from "@/lib/services/spotService"
import { EMPTY_SPOT_JOURNAL, serializeSpotTags } from "@/lib/services/spotJournalFields"
import type { SpotEntry, SpotHolding } from "@/types/spot"

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
 *
 * The download is a zip of three CSVs (buildSpotZip): the ledger above, one row
 * per ticker (tokens.csv) and one row for the whole portfolio (summary.csv).
 * CSV has no sheets, and three flat files keep every one of them a single table
 * any importer reads.
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
type Column<T> = { header: string; value: (r: T) => Cell }

const journalOf = (r: SpotLedgerRow) => r.entry.journal ?? EMPTY_SPOT_JOURNAL
const yesNo = (v: boolean | null) => (v == null ? null : v ? "yes" : "no")

export const SPOT_EXPORT_COLUMNS: readonly Column<SpotLedgerRow>[] = [
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


function toCsv<T>(columns: readonly Column<T>[], rows: readonly T[]): string {
  const lines = [columns.map((c) => c.header).join(",")]
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(","))
  // Trailing newline: some spreadsheet importers drop the final row without it.
  return lines.join("\r\n") + "\r\n"
}

/** One CSV row per entry, newest first — the reverse of replay order. */
export function buildSpotCsv(
  entries: SpotEntry[],
  currentPrices: Record<string, number> = {}
): string {
  return toCsv(SPOT_EXPORT_COLUMNS, buildSpotLedger(entries, currentPrices).reverse())
}

// ---------------------------------------------------------------- tokens.csv

/**
 * One ticker, as the dashboard's coin card shows it plus what the card leaves
 * out. Closed tickers are included (holding 0) so their realised PnL is kept.
 */
export interface SpotTokenRow {
  holding: SpotHolding
  /** Share of the priced open portfolio; null when closed or unpriced. */
  allocationPct: number | null
  firstEntryAt: string
  lastEntryAt: string
}

export function buildSpotTokens(
  entries: SpotEntry[],
  currentPrices: Record<string, number> = {}
): SpotTokenRow[] {
  const holdings = computeHoldings(entries, currentPrices)
  const allocation = new Map(buildAllocation(holdings).map((a) => [a.ticker, a.pct]))
  const span = new Map<string, { first: string; last: string }>()
  for (const e of entries) {
    const s = span.get(e.ticker)
    if (!s) span.set(e.ticker, { first: e.tradedAt, last: e.tradedAt })
    else {
      if (e.tradedAt < s.first) s.first = e.tradedAt
      if (e.tradedAt > s.last) s.last = e.tradedAt
    }
  }
  return holdings.map((h) => ({
    holding: h,
    allocationPct: allocation.get(h.ticker) ?? null,
    firstEntryAt: span.get(h.ticker)!.first,
    lastEntryAt: span.get(h.ticker)!.last,
  }))
}

// Unpriced tickers leave value and PnL blank (computeHolding's nulls), never 0.
export const SPOT_TOKEN_COLUMNS: readonly Column<SpotTokenRow>[] = [
  { header: "ticker", value: (r) => r.holding.ticker },
  { header: "status", value: (r) => (r.holding.qty > DUST ? "open" : "closed") },
  { header: "holding", value: (r) => num(r.holding.qty) },
  { header: "avgEntry", value: (r) => num(r.holding.avgEntry) },
  { header: "currentPrice", value: (r) => r.holding.currentPrice },
  { header: "costBasis", value: (r) => num(r.holding.costBasis) },
  { header: "totalInvested", value: (r) => num(r.holding.totalInvested) },
  { header: "marketValue", value: (r) => num(r.holding.marketValue) },
  { header: "unrealisedPnl", value: (r) => num(r.holding.unrealisedPnl) },
  { header: "unrealisedPnlPct", value: (r) => num(r.holding.unrealisedPct) },
  { header: "realisedPnl", value: (r) => num(r.holding.realisedPnl) },
  { header: "allocationPct", value: (r) => num(r.allocationPct) },
  { header: "buyCount", value: (r) => r.holding.buyCount },
  // Sells that actually sold something — a fully oversold SELL is not counted.
  { header: "sellCount", value: (r) => r.holding.sellCount },
  { header: "firstEntryAt", value: (r) => r.firstEntryAt },
  { header: "lastEntryAt", value: (r) => r.lastEntryAt },
]

/** One row per ticker, in the dashboard's order (largest value first). */
export function buildSpotTokensCsv(
  entries: SpotEntry[],
  currentPrices: Record<string, number> = {}
): string {
  return toCsv(SPOT_TOKEN_COLUMNS, buildSpotTokens(entries, currentPrices))
}

// --------------------------------------------------------------- summary.csv

/** The dashboard's four tiles, plus what they are computed over. */
export interface SpotSummaryRow {
  totals: ReturnType<typeof computeTotals>
  exportedAt: string
  tickers: number
  entries: number
  /** Open tickers with no price: counted in cost basis but not in value. */
  unpricedTickers: string[]
  firstEntryAt: string | null
  lastEntryAt: string | null
}

export function buildSpotSummary(
  entries: SpotEntry[],
  currentPrices: Record<string, number> = {},
  now: Date = new Date()
): SpotSummaryRow {
  const holdings = computeHoldings(entries, currentPrices)
  const dates = entries.map((e) => e.tradedAt).sort()
  return {
    totals: computeTotals(holdings),
    exportedAt: now.toISOString(),
    tickers: holdings.length,
    entries: entries.length,
    unpricedTickers: holdings
      .filter((h) => h.qty > DUST && h.currentPrice == null)
      .map((h) => h.ticker)
      .sort(),
    firstEntryAt: dates[0] ?? null,
    lastEntryAt: dates.at(-1) ?? null,
  }
}

export const SPOT_SUMMARY_COLUMNS: readonly Column<SpotSummaryRow>[] = [
  { header: "exportedAt", value: (r) => r.exportedAt },
  { header: "portfolioValue", value: (r) => num(r.totals.marketValue) },
  { header: "costBasis", value: (r) => num(r.totals.costBasis) },
  { header: "totalInvested", value: (r) => num(r.totals.totalInvested) },
  { header: "unrealisedPnl", value: (r) => num(r.totals.unrealisedPnl) },
  { header: "unrealisedPnlPct", value: (r) => num(r.totals.unrealisedPct) },
  { header: "realisedPnl", value: (r) => num(r.totals.realisedPnl) },
  { header: "openPositions", value: (r) => r.totals.openTickers },
  { header: "tickers", value: (r) => r.tickers },
  { header: "entries", value: (r) => r.entries },
  { header: "unpricedTickers", value: (r) => r.unpricedTickers.join("|") },
  { header: "firstEntryAt", value: (r) => r.firstEntryAt },
  { header: "lastEntryAt", value: (r) => r.lastEntryAt },
]

/** A single data row — the whole portfolio. */
export function buildSpotSummaryCsv(
  entries: SpotEntry[],
  currentPrices: Record<string, number> = {},
  now: Date = new Date()
): string {
  return toCsv(SPOT_SUMMARY_COLUMNS, [buildSpotSummary(entries, currentPrices, now)])
}

// ----------------------------------------------------------------------- zip

/** File name → CSV text, in the order a reader should open them. */
export function buildSpotExportFiles(
  entries: SpotEntry[],
  currentPrices: Record<string, number> = {},
  now: Date = new Date()
): Record<string, string> {
  return {
    "summary.csv": buildSpotSummaryCsv(entries, currentPrices, now),
    "tokens.csv": buildSpotTokensCsv(entries, currentPrices),
    "ledger.csv": buildSpotCsv(entries, currentPrices),
  }
}

/**
 * The three CSVs zipped. Each carries a UTF-8 BOM, as downloadCsv adds to a
 * lone CSV, so Excel does not read the files as Latin-1 once unzipped. fflate is
 * loaded on demand so it costs nothing until the button is pressed.
 */
export async function buildSpotZip(
  entries: SpotEntry[],
  currentPrices: Record<string, number> = {},
  now: Date = new Date()
): Promise<Uint8Array> {
  const { strToU8, zipSync } = await import("fflate")
  const files = buildSpotExportFiles(entries, currentPrices, now)
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, csv]) => [name, strToU8("\uFEFF" + csv)])
    ),
    { mtime: now }
  )
}

/** e.g. `spot-2026-09-28.zip` — sits next to the trades export in a downloads folder. */
export function spotExportFilename(now: Date = new Date()): string {
  return `spot-${now.toISOString().slice(0, 10)}.zip`
}
