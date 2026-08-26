import { tradeKey } from "@/lib/db/trades"
import type { Trade, TradeBias, TradeOverride, TradeOverridesMap } from "@/types"

/**
 * Manual TP / SL / Bias, resolved against what the exchange reported.
 *
 * Kept free of any DB import so client components can use it: the rules below
 * are shared by the table, the CSV export and the API route, and re-deriving
 * them in each place is how "override wins" quietly stops being true somewhere.
 */

/** The fields a user can override, in the order the table shows them. */
export const OVERRIDE_FIELDS = ["tp", "sl", "bias"] as const
export type OverrideField = (typeof OVERRIDE_FIELDS)[number]

/** The two price fields. Narrower than OVERRIDE_FIELDS — bias is not a price. */
export const PRICE_FIELDS = ["tp", "sl"] as const
export type PriceField = (typeof PRICE_FIELDS)[number]

export function isBias(value: unknown): value is TradeBias {
  return value === "buy" || value === "sell"
}

export function isPriceField(value: unknown): value is PriceField {
  return value === "tp" || value === "sl"
}

/**
 * A price is only storable if it is a finite, non-negative number. Rejecting
 * NaN/Infinity here keeps them out of a NUMERIC column, where they would either
 * error or come back as something the UI cannot format.
 */
export function isStorablePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

/**
 * The bias implied by the exchange's own `side`. Only Bybit and Bitunix report
 * one, so this is null for most trades and the user supplies it by hand.
 */
export function sideToBias(side: Trade["side"]): TradeBias | null {
  if (side === "long") return "buy"
  if (side === "short") return "sell"
  return null
}

/**
 * A trade with its overrides applied. `bias` is resolved here rather than on
 * Trade itself so `Trade` — and every path that writes it back to
 * cached_trades — stays exactly as it was.
 */
export interface ResolvedTrade extends Trade {
  bias: TradeBias | null
  /** Which fields the user set by hand, so the UI can mark them. */
  overridden: Record<OverrideField, boolean>
}

/**
 * Applies one trade's overrides. An override always wins over the exchange
 * value, including when the exchange did report one — no adapter populates tp
 * or sl today, but if one starts, a user's correction still stands.
 */
export function resolveTrade(trade: Trade, override?: TradeOverride): ResolvedTrade {
  const o = override ?? {}
  const hasBias = isBias(o.bias)
  return {
    ...trade,
    tp: o.tp ?? trade.tp,
    sl: o.sl ?? trade.sl,
    bias: hasBias ? o.bias! : sideToBias(trade.side),
    overridden: {
      tp: o.tp !== undefined,
      sl: o.sl !== undefined,
      bias: hasBias,
    },
  }
}

/** Resolves a whole list against the overrides map the dashboard holds. */
export function resolveTrades(
  trades: Trade[],
  overrides: TradeOverridesMap = {}
): ResolvedTrade[] {
  return trades.map((t) => resolveTrade(t, overrides[tradeKey(t.exchange, t.id)]))
}

/**
 * Merges a patch onto a stored override. A key set to null clears that field
 * (falling back to the exchange value); a key left out is untouched — so the
 * table can save one cell without having to send the other two.
 *
 * Returns null when nothing is left overridden, which is the signal to delete
 * the row rather than store an empty one.
 */
export type OverridePatch = {
  tp?: number | null
  sl?: number | null
  bias?: TradeBias | null
}

export function mergeOverride(
  current: TradeOverride,
  patch: OverridePatch
): TradeOverride | null {
  const next: TradeOverride = { ...current }

  for (const field of PRICE_FIELDS) {
    if (!(field in patch)) continue
    const value = patch[field]
    if (value === null || value === undefined) delete next[field]
    else if (isStorablePrice(value)) next[field] = value
  }

  if ("bias" in patch) {
    if (isBias(patch.bias)) next.bias = patch.bias
    else delete next.bias
  }

  return next.tp === undefined && next.sl === undefined && next.bias === undefined
    ? null
    : next
}
