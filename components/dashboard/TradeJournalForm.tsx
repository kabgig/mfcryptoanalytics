"use client"

import { useMemo, useState } from "react"
import { ClipboardList, Loader2, X } from "lucide-react"
import {
  CHOICES,
  choiceLabel,
  computeRr,
  EXIT_REASONS,
  KILLZONES,
  MISTAKES,
  EMOTIONS,
  MULTI_CHOICE_FIELDS,
  normalizeChoices,
  parseChoices,
  serializeChoices,
  SINGLE_CHOICE_FIELDS,
  STRATEGIES,
  TIMEFRAMES,
} from "@/lib/services/journalFields"
import type { OverridePatch, ResolvedTrade } from "@/lib/services/overridesService"
import type { SaveOverride } from "@/components/dashboard/TradeOverrideCell"
import type {
  TradeJournalChoice,
  TradeJournalMultiChoice,
  TradeJournalSingleChoice,
  TradeOverride,
} from "@/types"

/**
 * The full journal entry for one trade: the plan written before the entry and
 * the review written after the exit.
 *
 * A modal rather than a popover — fourteen fields do not belong hanging off a
 * table cell — following the overlay pattern in components/settings/ApiKeysModal.
 * Everything is saved in one request, because half the value of the form is
 * seeing plan and outcome next to each other.
 */

const inputClass =
  "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring"

/**
 * The form's own state: every field as a string.
 *
 * The multi-select fields ride in the same flat string map as everything else,
 * holding their tags '|'-joined — the same shape the column stores. Keeping one
 * `Record<string, string>` means `set()`, the dirty-checking and the seeding all
 * stay one code path rather than forking on which kind of field they touch.
 */
type Draft = Record<string, string>

const NUMBER_KEYS = ["entry", "tp1", "tp2", "sl", "riskPct", "rr"] as const
const SINGLE_CHOICE_KEYS: readonly TradeJournalSingleChoice[] = SINGLE_CHOICE_FIELDS
const MULTI_CHOICE_KEYS: readonly TradeJournalMultiChoice[] = MULTI_CHOICE_FIELDS

function toDraft(journal: TradeOverride): Draft {
  const draft: Draft = {}
  for (const key of NUMBER_KEYS) {
    const value = journal[key]
    draft[key] = value === undefined ? "" : String(value)
  }
  for (const key of SINGLE_CHOICE_KEYS) draft[key] = journal[key] ?? ""
  for (const key of MULTI_CHOICE_KEYS) {
    draft[key] = serializeChoices(journal[key] ?? []) ?? ""
  }
  draft.rulesOK = journal.rulesOK === undefined ? "" : journal.rulesOK ? "yes" : "no"
  return draft
}

/** "" means the field is cleared; anything else is validated by the API too. */
function toPatch(draft: Draft): OverridePatch {
  const patch: OverridePatch = {}
  for (const key of NUMBER_KEYS) {
    const raw = draft[key].trim()
    patch[key] = raw === "" ? null : Number(raw)
  }
  for (const key of SINGLE_CHOICE_KEYS) patch[key] = draft[key] === "" ? null : draft[key]
  for (const key of MULTI_CHOICE_KEYS) {
    // An empty selection is sent as null rather than [], so clearing the last
    // field still deletes the row instead of writing an empty one.
    const values = parseChoices(key, draft[key])
    patch[key] = values.length === 0 ? null : values
  }
  patch.rulesOK = draft.rulesOK === "" ? null : draft.rulesOK === "yes"
  return patch
}

function Field({ label, hint, children }: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {hint && <span className="ml-1 font-normal opacity-70">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Choice({
  field,
  value,
  onChange,
  options,
  placeholder,
}: {
  field: string
  value: string
  onChange: (next: string) => void
  options: readonly string[]
  placeholder: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={`journal-${field}`}
      className={inputClass}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option} value={option}>{choiceLabel(option)}</option>
      ))}
    </select>
  )
}

/**
 * A checkbox group for a field that takes several tags at once.
 *
 * Checkboxes rather than a multi-select listbox: every option stays on screen
 * with its full label, and picking a second one does not need a modifier key
 * that half of users do not know about. The whole selection lives in the draft
 * as one '|'-joined string, so the group is as controlled as the <select> it
 * replaced — and `data-value` exposes that string for tests to assert on, since
 * a fieldset has no inputValue().
 */
function MultiChoice({
  field,
  value,
  onChange,
  options,
  columns = 2,
}: {
  field: TradeJournalChoice
  value: string
  onChange: (next: string) => void
  options: readonly string[]
  columns?: 1 | 2 | 3
}) {
  const selected = useMemo(() => new Set(parseChoices(field, value)), [field, value])

  function toggle(option: string) {
    const next = new Set(selected)
    if (next.has(option)) next.delete(option)
    else next.add(option)
    // Normalized on every toggle, so the stored order is the vocabulary's and
    // not the order the user happened to click in.
    onChange(serializeChoices(normalizeChoices(field, [...next])) ?? "")
  }

  const gridClass =
    columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-1"

  return (
    <fieldset
      data-testid={`journal-${field}`}
      data-value={value}
      className={`grid grid-cols-1 gap-x-3 gap-y-1.5 rounded-md border border-input bg-background px-2.5 py-2 shadow-sm ${gridClass}`}
    >
      {options.map((option) => (
        <label
          key={option}
          data-testid={`journal-${field}-${option}`}
          // min-w-0 so the label can shrink below its content: a grid item will
          // not do that by default, and the longest mistake labels are wider
          // than half the modal.
          className="flex min-w-0 cursor-pointer items-start gap-2 text-sm leading-snug"
        >
          <input
            type="checkbox"
            checked={selected.has(option)}
            onChange={() => toggle(option)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-sky-500"
          />
          {/* whitespace-normal is load-bearing: this modal is rendered from
              inside a table cell that sets whitespace-nowrap, and the rule
              inherits through the fixed-position overlay. Without it the long
              labels refuse to wrap and overlap the next column's checkbox. */}
          <span className="whitespace-normal">{choiceLabel(option)}</span>
        </label>
      ))}
    </fieldset>
  )
}

function NumberInput({
  field,
  value,
  onChange,
  placeholder,
  max,
}: {
  field: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  max?: number
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="any"
      min="0"
      max={max}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={`journal-${field}`}
      className={inputClass}
    />
  )
}

export function TradeJournalForm({
  trade,
  onSave,
  onClose,
}: {
  trade: ResolvedTrade
  onSave: SaveOverride
  onClose: () => void
}) {
  // Seeded once — the modal unmounts on close, so every open starts from what is
  // currently stored rather than from stale state.
  const [draft, setDraft] = useState<Draft>(() => toDraft(trade.journal))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: string) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  // R:R follows entry/TP1/SL as they are typed. The user can type over it, and
  // clearing their number hands the field back to the arithmetic.
  const num = (key: string) => {
    const raw = draft[key].trim()
    if (raw === "") return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  const computedRr = useMemo(
    () => computeRr(num("entry"), num("tp1"), num("sl")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft.entry, draft.tp1, draft.sl]
  )
  const rrIsManual = draft.rr.trim() !== ""

  async function submit() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(trade, toPatch(draft))
      onClose()
    } catch (err) {
      setError(String(err))
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-10 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        data-testid="journal-form"
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardList className="h-4 w-4" />
            Journal · <span className="font-mono">{trade.ticker}</span>
            <span className="font-normal text-muted-foreground">{trade.exchange}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close journal"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Plan <span className="font-normal normal-case opacity-70">— before the entry</span>
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Strategy">
                <Choice field="strategy" value={draft.strategy} onChange={set("strategy")}
                  options={STRATEGIES} placeholder="—" />
              </Field>
              <Field label="Timeframe">
                <Choice field="timeframe" value={draft.timeframe} onChange={set("timeframe")}
                  options={TIMEFRAMES} placeholder="—" />
              </Field>
              <Field label="Killzone">
                <Choice field="killzone" value={draft.killzone} onChange={set("killzone")}
                  options={KILLZONES} placeholder="—" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Entry">
                <NumberInput field="entry" value={draft.entry} onChange={set("entry")} placeholder="price" />
              </Field>
              <Field label="TP1" hint="first target">
                <NumberInput field="tp1" value={draft.tp1} onChange={set("tp1")} placeholder="price" />
              </Field>
              <Field label="TP2" hint="runner">
                <NumberInput field="tp2" value={draft.tp2} onChange={set("tp2")} placeholder="price" />
              </Field>
              <Field label="SL">
                <NumberInput field="sl" value={draft.sl} onChange={set("sl")} placeholder="price" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Risk %" hint="of deposit">
                <NumberInput field="riskPct" value={draft.riskPct} onChange={set("riskPct")}
                  placeholder="e.g. 1" max={100} />
              </Field>
              <Field label="R:R" hint={rrIsManual ? "yours" : "auto"}>
                <NumberInput
                  field="rr"
                  value={draft.rr}
                  onChange={set("rr")}
                  placeholder={computedRr === null ? "entry, TP1, SL" : String(computedRr)}
                />
              </Field>
              <div className="col-span-2 flex items-end">
                <p className="text-xs text-muted-foreground" data-testid="journal-rr-readout">
                  {computedRr === null
                    ? "R:R needs an entry, a TP1 and an SL."
                    : rrIsManual
                      ? `Computed R:R is ${computedRr} — clear the field to use it.`
                      : `R:R ${computedRr} from your levels.`}
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Review <span className="font-normal normal-case opacity-70">— after the exit</span>
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Rules followed">
                <select
                  value={draft.rulesOK}
                  onChange={(e) => set("rulesOK")(e.target.value)}
                  data-testid="journal-rulesOK"
                  className={inputClass}
                >
                  <option value="">—</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Field>
            </div>
            {/* Full width, not in the two-column grid above: fifteen mistake
                labels are sentences, and squeezing them into half the modal
                wraps every one of them. */}
            <Field label="Exit reason" hint="tick every one that applied">
              <MultiChoice field="exitReason" value={draft.exitReason}
                onChange={set("exitReason")} options={EXIT_REASONS} columns={3} />
            </Field>
            <Field label="Mistakes" hint="tick every one that applied">
              <MultiChoice field="mistake" value={draft.mistake}
                onChange={set("mistake")} options={MISTAKES} columns={2} />
            </Field>
            <Field label="Emotions" hint="tick every one that applied">
              <MultiChoice field="emotion" value={draft.emotion}
                onChange={set("emotion")} options={EMOTIONS} columns={3} />
            </Field>
          </section>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            data-testid="journal-save"
            className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/** The 📋 trigger on a trade row. Accented once the trade has a journal entry. */
export function TradeJournalButton({
  trade,
  onSave,
  disabled,
}: {
  trade: ResolvedTrade
  onSave?: SaveOverride
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!onSave) return null

  // Bias lives in its own column, so it does not count towards "has a journal".
  const filled = Object.keys(trade.journal).some((k) => k !== "bias")

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid="journal-open"
        data-filled={filled ? "true" : "false"}
        aria-label={`Journal for ${trade.ticker} trade${filled ? " (filled in)" : ""}`}
        title={filled ? "Journal — click to edit" : "Journal — plan and review"}
        className={`flex h-6 w-6 items-center justify-center rounded transition-colors disabled:pointer-events-none disabled:opacity-40 ${
          filled
            ? "text-sky-500 hover:bg-sky-500/15"
            : "text-muted-foreground/40 hover:bg-muted hover:text-foreground"
        }`}
      >
        <ClipboardList className="h-4 w-4" />
      </button>
      {open && (
        <TradeJournalForm trade={trade} onSave={onSave} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

export { CHOICES }
