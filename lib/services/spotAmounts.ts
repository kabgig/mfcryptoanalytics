/**
 * The spot entry form takes any two of coins, dollars spent and price per coin,
 * and derives the third. Kept pure so the rules are unit-testable without a DOM.
 */

export type AmountField = "qty" | "usd" | "price"

export const AMOUNT_FIELDS: readonly AmountField[] = ["qty", "usd", "price"]

export type AmountInputs = Record<AmountField, string>
export type AmountValues = Record<AmountField, number>

/**
 * Records an edit. `order` holds the two most recently typed fields, newest
 * first; typing into the derived field promotes it and demotes the oldest.
 */
export function touchField(order: AmountField[], field: AmountField): AmountField[] {
  return [field, ...order.filter((f) => f !== field)].slice(0, 2)
}

/** The field computed from the other two, or null until two have been typed. */
export function derivedField(order: AmountField[]): AmountField | null {
  if (order.length < 2) return null
  return AMOUNT_FIELDS.find((f) => !order.includes(f)) ?? null
}

/** A positive finite number, or NaN for blank, malformed, zero or negative. */
export function parseAmount(s: string): number {
  const t = s.trim()
  if (!t) return NaN
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : NaN
}

/**
 * All three values, with the derived one computed from the two typed ones.
 * Null when fewer than two fields are typed or either typed value is invalid.
 */
export function solveAmounts(inputs: AmountInputs, order: AmountField[]): AmountValues | null {
  const derived = derivedField(order)
  if (!derived) return null

  const qty = parseAmount(inputs.qty)
  const usd = parseAmount(inputs.usd)
  const price = parseAmount(inputs.price)

  let out: AmountValues
  if (derived === "price") out = { qty, usd, price: usd / qty }
  else if (derived === "qty") out = { qty: usd / price, usd, price }
  else out = { qty, usd: qty * price, price }

  const ok = AMOUNT_FIELDS.every((f) => Number.isFinite(out[f]) && out[f] > 0)
  return ok ? out : null
}

/**
 * Renders a derived value for display inside an input: plain digits, no "$",
 * no exponent notation (a $0.000003 coin must not show as "3e-6"), and enough
 * decimals that a small-cap price is not rounded to zero.
 */
export function formatDerived(v: number, field: AmountField): string {
  const abs = Math.abs(v)
  const decimals =
    field === "usd"
      ? 2
      : abs >= 1000
        ? 2
        : abs >= 1
          ? 4
          : Math.min(20, Math.max(field === "qty" ? 8 : 6, Math.ceil(-Math.log10(abs)) + 3))
  const fixed = v.toFixed(decimals)
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed
}
