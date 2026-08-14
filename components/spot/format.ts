/** Shared number formatting for the spot views. */

export function usd(v: number, maxFrac = 2): string {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: maxFrac,
  })
}

/**
 * Prices span BTC (~$60,000) to meme coins (~$0.000003), so a fixed precision
 * would render small caps as "$0.00". Scale the decimals to the magnitude.
 */
export function price(v: number): string {
  if (v === 0) return "$0"
  const abs = Math.abs(v)
  if (abs >= 1000) return usd(v, 0)
  if (abs >= 1) return usd(v, 2)
  if (abs >= 0.01) return usd(v, 4)
  return `$${v.toPrecision(3)}`
}

/** Coin quantities: trims trailing zeros rather than padding to a fixed width. */
export function qty(v: number): string {
  if (v === 0) return "0"
  const abs = Math.abs(v)
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8
  return Number(v.toFixed(decimals)).toString()
}

export function pct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`
}

export function signedUsd(v: number): string {
  return `${v >= 0 ? "+" : "-"}${usd(Math.abs(v))}`
}
