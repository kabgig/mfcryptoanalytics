import type { Trade } from "@/types"

/**
 * Every timeframe preset known to the app — the union of what the dashboard views
 * and the viz pages each offer. Previously duplicated inline in each view; this is
 * now the single source of truth so a selection stays valid across pages.
 */
export const PERIODS = [
  { label: "1d",  days: 1 },
  { label: "1w",  days: 7 },
  { label: "2w",  days: 14 },
  { label: "1m",  days: 30 },
  { label: "3m",  days: 90 },
  { label: "6m",  days: 180 },
  { label: "1y",  days: 365 },
  { label: "2y",  days: 730 },
  { label: "All", days: Infinity },
] as const

export type PeriodLabel = typeof PERIODS[number]["label"]

export interface Period {
  label: PeriodLabel
  days: number
}

function pick(labels: PeriodLabel[]): Period[] {
  return labels.map((label) => PERIODS.find((p) => p.label === label)!)
}

/** Presets shown on the dashboard views — unchanged from before the refactor. */
export const DASHBOARD_PERIODS = pick(["1d", "1w", "2w", "1m", "3m", "6m", "1y", "2y"])

/** Presets shown on the viz pages — unchanged from before the refactor. */
export const VIZ_PERIODS = pick(["1d", "1w", "1m", "3m", "6m", "1y", "All"])

/**
 * Either one of the rolling presets above, or an absolute date range.
 * `from` / `to` are "YYYY-MM-DD" and both ends are inclusive.
 */
export type PeriodSelection =
  | { kind: "preset"; label: PeriodLabel }
  | { kind: "custom"; from: string; to: string }

export const DEFAULT_PERIOD: PeriodSelection = { kind: "preset", label: "3m" }

const DAY_MS = 86_400_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime())
}

/** Narrows an unknown value (e.g. rehydrated from storage) to a usable selection. */
export function isValidSelection(value: unknown): value is PeriodSelection {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  if (v.kind === "preset") {
    return PERIODS.some((p) => p.label === v.label)
  }
  if (v.kind === "custom") {
    return (
      typeof v.from === "string" &&
      typeof v.to === "string" &&
      isRealDate(v.from) &&
      isRealDate(v.to) &&
      v.from <= v.to
    )
  }
  return false
}

/**
 * Epoch bounds for a selection.
 * Presets keep the original semantics: a lower bound only, no upper bound.
 */
export function periodBounds(sel: PeriodSelection): { start: number; end: number } {
  if (sel.kind === "custom") {
    return {
      start: new Date(`${sel.from}T00:00:00`).getTime(),
      end: new Date(`${sel.to}T23:59:59.999`).getTime(),
    }
  }
  const days = PERIODS.find((p) => p.label === sel.label)?.days ?? 90
  return { start: Date.now() - days * DAY_MS, end: Infinity }
}

/** Filters trades by closeTime, matching the behaviour every view used before. */
export function filterTradesBySelection(trades: Trade[], sel: PeriodSelection): Trade[] {
  const { start, end } = periodBounds(sel)
  return trades.filter((t) => {
    const ts = new Date(t.closeTime).getTime()
    return ts >= start && ts <= end
  })
}

/** Length of the selection in days — used to scale period-relative reference values. */
export function selectionDays(sel: PeriodSelection): number {
  if (sel.kind === "custom") {
    const { start, end } = periodBounds(sel)
    return Math.max(1, Math.ceil((end - start) / DAY_MS))
  }
  return PERIODS.find((p) => p.label === sel.label)?.days ?? 90
}

function fmtDay(value: string): string {
  const d = new Date(`${value}T00:00:00`)
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
}

/** Short human label: "3m" for presets, "12 Mar – 04 Apr" for custom ranges. */
export function selectionLabel(sel: PeriodSelection): string {
  if (sel.kind === "preset") return sel.label
  return `${fmtDay(sel.from)} – ${fmtDay(sel.to)}`
}

/** "YYYY-MM-DD" for today, in local time — used as the max for the date inputs. */
export function todayIso(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}
