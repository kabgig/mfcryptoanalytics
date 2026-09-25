"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { heldQty } from "@/lib/services/spotService"
import {
  derivedField,
  formatDerived,
  parseAmount,
  solveAmounts,
  touchField,
  type AmountField,
  type AmountInputs,
} from "@/lib/services/spotAmounts"
import type { SpotEntry } from "@/types/spot"
import { qty as fmtQty } from "./format"

interface Props {
  tickers: string[]
  entries: SpotEntry[]
  onAdd: (e: {
    ticker: string
    side: "BUY" | "SELL"
    qty: number
    price: number
    tradedAt: string
  }) => Promise<string | null>
}

const EMPTY_AMOUNTS: AmountInputs = { qty: "", usd: "", price: "" }

const AMOUNT_META: Record<AmountField, { label: string; placeholder: string; testid: string }> = {
  qty: { label: "Coins", placeholder: "0.005", testid: "spot-coins" },
  usd: { label: "$ Spent", placeholder: "500", testid: "spot-usd" },
  price: { label: "Price / coin", placeholder: "95000", testid: "spot-price" },
}

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"

export function SpotEntryForm({ tickers, entries, onAdd }: Props) {
  const [ticker, setTicker] = useState("")
  const [side, setSide] = useState<"BUY" | "SELL">("BUY")
  const [inputs, setInputs] = useState<AmountInputs>(EMPTY_AMOUNTS)
  // The two fields typed most recently; the third is computed from them.
  const [order, setOrder] = useState<AmountField[]>([])
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  const suggestions = useMemo(() => {
    const q = ticker.trim().toUpperCase()
    if (!q) return tickers.slice(0, 8)
    return tickers.filter((t) => t.startsWith(q)).slice(0, 8)
  }, [ticker, tickers])

  // Any two of coins / dollars / price determine the third. The derived one is
  // shown formatted, but the exact value is what gets submitted.
  const derived = derivedField(order)
  const solved = solveAmounts(inputs, order)

  function displayValue(f: AmountField): string {
    if (f !== derived) return inputs[f]
    return solved ? formatDerived(solved[f], f) : ""
  }

  function onAmountChange(f: AmountField, value: string) {
    setInputs((prev) => ({ ...prev, [f]: value }))
    setOrder((prev) => touchField(prev, f))
  }

  const upperTicker = ticker.trim().toUpperCase()
  const held = useMemo(
    () => (upperTicker ? heldQty(entries, upperTicker) : 0),
    [entries, upperTicker]
  )

  const known = tickers.length === 0 || tickers.includes(upperTicker)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!upperTicker) return setError("Pick a ticker")
    if (!known) return setError(`${upperTicker} has no USD price feed on Coinbase`)
    if (!derived) return setError("Fill any two of coins, $ spent and price")
    for (const f of order) {
      if (Number.isNaN(parseAmount(inputs[f]))) {
        return setError(`Enter ${AMOUNT_META[f].label.toLowerCase()} greater than 0`)
      }
    }
    if (!solved) return setError("Amounts are invalid")
    if (side === "SELL" && solved.qty > held) {
      return setError(`Only ${fmtQty(held)} ${upperTicker} held`)
    }

    setSaving(true)
    const err = await onAdd({
      ticker: upperTicker,
      side,
      qty: solved.qty,
      price: solved.price,
      // Midday UTC keeps the entry on the intended calendar day regardless of
      // the viewer's timezone, since the charts bucket by YYYY-MM-DD.
      tradedAt: new Date(`${date}T12:00:00.000Z`).toISOString(),
    })
    setSaving(false)

    if (err) return setError(err)
    setInputs(EMPTY_AMOUNTS)
    setOrder([])
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Add entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {/* Ticker with autocomplete */}
            <div className="relative" ref={boxRef}>
              <label className="mb-1 block text-xs text-muted-foreground">Ticker</label>
              <input
                data-testid="spot-ticker"
                className={inputClass}
                value={ticker}
                placeholder="BTC"
                autoComplete="off"
                onChange={(e) => {
                  setTicker(e.target.value.toUpperCase())
                  setOpen(true)
                }}
                onFocus={() => setOpen(true)}
              />
              {open && suggestions.length > 0 && (
                <div className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-background py-1 shadow-md">
                  {suggestions.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        setTicker(t)
                        setOpen(false)
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Side */}
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Side</label>
              <div className="flex rounded-md border border-input p-0.5">
                {(["BUY", "SELL"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    data-testid={`spot-side-${s}`}
                    onClick={() => setSide(s)}
                    className={`flex-1 rounded px-2 py-1.5 text-sm font-medium transition-colors ${
                      side === s
                        ? s === "BUY"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-red-500/15 text-red-600 dark:text-red-400"
                        : "text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Coins, $ spent, price — any two derive the third */}
            {(["qty", "usd", "price"] as const).map((f) => {
              const meta = AMOUNT_META[f]
              const isDerived = f === derived
              return (
                <div key={f}>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">{meta.label}</label>
                    {isDerived && (
                      <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                        auto
                      </span>
                    )}
                  </div>
                  <input
                    data-testid={meta.testid}
                    data-derived={isDerived ? "true" : undefined}
                    className={`${inputClass} ${isDerived ? "text-muted-foreground" : ""}`}
                    value={displayValue(f)}
                    inputMode="decimal"
                    placeholder={meta.placeholder}
                    onChange={(e) => onAmountChange(f, e.target.value)}
                  />
                </div>
              )
            })}

            {/* Date */}
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Date</label>
              <input
                type="date"
                data-testid="spot-date"
                className={inputClass}
                value={date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {side === "SELL" && upperTicker && (
                <span>
                  Held: {fmtQty(held)} {upperTicker}
                </span>
              )}
            </div>

            <button
              type="submit"
              data-testid="spot-submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add
            </button>
          </div>

          {error && (
            <p data-testid="spot-error" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
