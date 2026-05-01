import type { Trade } from "@/types"

export interface ParseResult {
  trades: Trade[]
  /** Rows that were skipped due to missing/unparseable data */
  skippedRows: number
}

interface RawRow {
  createdAt: string
  txId: string
  asset: string
  position: string      // "Long" | "Short"
  positionChange: string // "Increase" | "Decrease"
  orderType: string
  depositWithdraw: string
  executionPrice: string
  tradeSize: string
  pnl: string
  tradeFee: string
}

function parseTimestamp(raw: string): string | null {
  // "Tue Apr 21 2026 08:47:49 GMT+0000 (Coordinated Universal Time)"
  const d = new Date(raw.trim())
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

function parseNum(raw: string): number {
  const v = parseFloat(raw.trim())
  return isNaN(v) ? 0 : v
}

function parseCsvLine(line: string): string[] {
  // Simple comma split — Jupiter CSV does not quote fields
  return line.split(",").map((f) => f.trim())
}

/**
 * Parses a Jupiter Perps CSV export into Trade objects.
 *
 * Strategy (Option A):
 *  - Only "Decrease" rows become trades (they carry the realized PnL).
 *  - openTime = timestamp of the most recent "Increase" row for the same
 *    asset + position direction that appears before this Decrease in the file.
 *    Falls back to closeTime when no matching Increase is found.
 */
export function parseJupiterCsv(csvText: string): ParseResult {
  const lines = csvText.split("\n").map((l) => l.trim()).filter(Boolean)

  if (lines.length < 2) return { trades: [], skippedRows: 0 }

  // Skip header
  const dataLines = lines.slice(1)

  const rawRows: RawRow[] = []
  let skippedRows = 0

  for (const line of dataLines) {
    const cols = parseCsvLine(line)
    if (cols.length < 11) { skippedRows++; continue }

    rawRows.push({
      createdAt:      cols[0],
      txId:           cols[1],
      asset:          cols[2],
      position:       cols[3],
      positionChange: cols[4],
      orderType:      cols[5],
      depositWithdraw: cols[6],
      executionPrice: cols[7],
      tradeSize:      cols[8],
      pnl:            cols[9],
      tradeFee:       cols[10],
    })
  }

  // Build a lookup: asset+side → last seen Increase timestamp (ISO)
  // We iterate forward through time so we maintain "most recent Increase before
  // each Decrease". The CSV is newest-first, so we reverse to process oldest-first.
  const reversed = [...rawRows].reverse()

  // key = `${asset}|${position}` (e.g. "BTC|Short")
  const lastIncreaseTime = new Map<string, string>()
  const trades: Trade[] = []

  for (const row of reversed) {
    const key = `${row.asset}|${row.position}`
    const ts = parseTimestamp(row.createdAt)
    if (!ts) { skippedRows++; continue }

    if (row.positionChange === "Increase") {
      lastIncreaseTime.set(key, ts)
      continue
    }

    if (row.positionChange !== "Decrease") continue

    const closeTime = ts
    const openTime = lastIncreaseTime.get(key) ?? closeTime

    const pnl = parseNum(row.pnl)
    const tradeSize = parseNum(row.tradeSize)
    const side = row.position.toLowerCase() as Trade["side"]

    trades.push({
      id:           row.txId,
      exchange:     "Jupiter Perps",
      ticker:       row.asset,
      positionSize: tradeSize,
      tp:           null,
      sl:           null,
      openTime,
      closeTime,
      pnl,
      market:       "futures",
      side,
    })
  }

  // Return newest-first (consistent with rest of the app)
  trades.sort((a, b) => new Date(b.closeTime).getTime() - new Date(a.closeTime).getTime())

  return { trades, skippedRows }
}
