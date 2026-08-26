"use client"

import { useState } from "react"
import { Popover } from "@base-ui/react/popover"
import { Loader2, Pencil } from "lucide-react"
import type { TradeBias } from "@/types"
import type { OverridePatch, PriceField, ResolvedTrade } from "@/lib/services/overridesService"

/**
 * The editable TP / SL / Bias cells.
 *
 * No exchange adapter reports a take-profit or stop-loss (they all hardcode
 * null), so in practice these cells are how those numbers get filled in at all.
 * A saved value always wins over whatever the exchange sent, and clearing it
 * hands the cell back to the exchange value.
 */

export type SaveOverride = (trade: ResolvedTrade, patch: OverridePatch) => Promise<void>

const FIELD_LABEL: Record<PriceField, string> = { tp: "Take profit", sl: "Stop loss" }

export function formatPrice(value: number | null) {
  if (value === null) return "—"
  // Up to 8 decimals so sub-cent tickers survive; trailing zeros trimmed.
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 8 })}`
}

/** Shared chrome: a cell that turns into a popover editor when clicked. */
function EditableCell({
  label,
  display,
  overridden,
  disabled,
  editable,
  testid,
  align = "right",
  children,
}: {
  label: string
  display: React.ReactNode
  overridden: boolean
  disabled?: boolean
  editable: boolean
  testid: string
  align?: "right" | "left"
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  // Read-only tables (share links, import previews) render the plain value, so
  // nothing about them changes beyond the value itself.
  if (!editable) {
    return (
      <span data-testid={testid} data-overridden={overridden ? "true" : "false"}>
        {display}
      </span>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        disabled={disabled}
        data-testid={testid}
        data-overridden={overridden ? "true" : "false"}
        aria-label={`${label} — ${overridden ? "edit" : "set"}`}
        title={overridden ? `${label} (set by you) — click to edit` : `${label} — click to set`}
        className={`group/cell flex w-full items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-60 ${
          align === "right" ? "justify-end" : "justify-start"
        } ${overridden ? "text-sky-500" : ""}`}
      >
        {display}
        <Pencil className="h-3 w-3 shrink-0 text-muted-foreground/0 transition-colors group-hover/cell:text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="center" sideOffset={6} className="z-50">
          <Popover.Popup
            data-testid="override-popup"
            className="rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
          >
            {children(() => setOpen(false))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Save / Clear footer shared by both editors. */
function EditorActions({
  onClear,
  onSave,
  onCancel,
  saving,
  canClear,
  hint,
}: {
  onClear: () => void
  onSave?: () => void
  onCancel: () => void
  saving: boolean
  canClear: boolean
  hint?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onClear}
        disabled={!canClear || saving}
        data-testid="override-clear"
        className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        Clear
      </button>
      <div className="flex items-center gap-2">
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Cancel
        </button>
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            data-testid="override-save"
            className="flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </button>
        )}
      </div>
    </div>
  )
}

function PriceEditor({
  trade,
  field,
  onSave,
  onDone,
}: {
  trade: ResolvedTrade
  field: PriceField
  onSave: SaveOverride
  onDone: () => void
}) {
  const stored = trade.overridden[field] ? trade[field] : null
  // Seeded once — the popup unmounts on close, so every open starts from what
  // is currently stored rather than from stale state.
  const [text, setText] = useState(stored === null ? "" : String(stored))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(value: number | null) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(trade, { [field]: value } as OverridePatch)
      onDone()
    } catch (err) {
      setError(String(err))
      setSaving(false)
    }
  }

  function save() {
    const trimmed = text.trim()
    if (trimmed === "") return void submit(null)
    const num = Number(trimmed)
    if (!Number.isFinite(num) || num < 0) {
      setError("Enter a non-negative number")
      return
    }
    void submit(num)
  }

  return (
    <div className="flex w-60 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold">
          {FIELD_LABEL[field]} · <span className="font-mono">{trade.ticker}</span>
        </span>
      </div>
      <p className="text-[11px] leading-tight text-muted-foreground">
        {trade.overridden[field]
          ? "Your value. Clear it to fall back to the exchange."
          : "Not reported by the exchange — set it yourself."}
      </p>
      <input
        autoFocus
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            save()
          }
        }}
        data-testid="override-input"
        placeholder="e.g. 70000"
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      <EditorActions
        onClear={() => void submit(null)}
        onSave={save}
        onCancel={onDone}
        saving={saving}
        canClear={trade.overridden[field]}
        hint="↵ to save"
      />
    </div>
  )
}

export function PriceOverrideCell({
  trade,
  field,
  onSave,
  disabled,
}: {
  trade: ResolvedTrade
  field: PriceField
  onSave?: SaveOverride
  disabled?: boolean
}) {
  const value = trade[field]
  return (
    <EditableCell
      label={FIELD_LABEL[field]}
      testid={`${field}-cell`}
      overridden={trade.overridden[field]}
      disabled={disabled}
      editable={Boolean(onSave)}
      display={
        value === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span>{formatPrice(value)}</span>
        )
      }
    >
      {(close) => (
        <PriceEditor trade={trade} field={field} onSave={onSave!} onDone={close} />
      )}
    </EditableCell>
  )
}

const BIAS_STYLE: Record<TradeBias, string> = {
  buy: "text-emerald-500",
  sell: "text-red-500",
}

function BiasEditor({
  trade,
  onSave,
  onDone,
}: {
  trade: ResolvedTrade
  onSave: SaveOverride
  onDone: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(value: TradeBias | null) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(trade, { bias: value })
      onDone()
    } catch (err) {
      setError(String(err))
      setSaving(false)
    }
  }

  return (
    <div className="flex w-60 flex-col gap-2">
      <span className="text-xs font-semibold">
        Bias · <span className="font-mono">{trade.ticker}</span>
      </span>
      <p className="text-[11px] leading-tight text-muted-foreground">
        {trade.overridden.bias
          ? "Your bias. Clear it to fall back to the exchange."
          : trade.side
            ? `From the exchange (${trade.side}). Pick one to override it.`
            : "Not reported by the exchange — set it yourself."}
      </p>
      <div className="flex gap-2">
        {(["buy", "sell"] as TradeBias[]).map((bias) => (
          <button
            key={bias}
            type="button"
            onClick={() => void submit(bias)}
            disabled={saving}
            data-testid={`bias-${bias}`}
            aria-pressed={trade.bias === bias}
            className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium capitalize transition-colors disabled:opacity-50 ${
              trade.bias === bias
                ? bias === "buy"
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-500"
                  : "border-red-500/50 bg-red-500/15 text-red-500"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {bias}
          </button>
        ))}
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      <EditorActions
        onClear={() => void submit(null)}
        onCancel={onDone}
        saving={saving}
        canClear={trade.overridden.bias}
      />
    </div>
  )
}

export function BiasCell({
  trade,
  onSave,
  disabled,
}: {
  trade: ResolvedTrade
  onSave?: SaveOverride
  disabled?: boolean
}) {
  return (
    <EditableCell
      label="Bias"
      testid="bias-cell"
      align="left"
      overridden={trade.overridden.bias}
      disabled={disabled}
      editable={Boolean(onSave)}
      display={
        trade.bias === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            data-bias={trade.bias}
            className={`font-medium capitalize ${BIAS_STYLE[trade.bias]}`}
          >
            {trade.bias}
          </span>
        )
      }
    >
      {(close) => <BiasEditor trade={trade} onSave={onSave!} onDone={close} />}
    </EditableCell>
  )
}
