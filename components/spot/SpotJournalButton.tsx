"use client"

import { useState, type ReactNode } from "react"
import { Popover } from "@base-ui/react/popover"
import { Loader2, NotebookPen } from "lucide-react"
import {
  EMPTY_SPOT_JOURNAL,
  hasSpotJournal,
  MAX_SPOT_NOTE_LENGTH,
  SPOT_FEELINGS,
  SPOT_WHY,
  spotTagLabel,
} from "@/lib/services/spotJournalFields"
import type { SpotEntry, SpotJournal } from "@/types/spot"

/** Resolves to null once saved, or to the error message to show. */
export type SaveSpotJournal = (id: string, journal: SpotJournal) => Promise<string | null>

const chipClass = (on: boolean) =>
  `rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
    on
      ? "border-sky-500 bg-sky-500/15 text-sky-600 dark:text-sky-400"
      : "border-input text-muted-foreground hover:bg-muted hover:text-foreground"
  }`

function Chips({
  field,
  options,
  selected,
  onToggle,
}: {
  field: string
  options: readonly string[]
  selected: readonly string[]
  onToggle: (tag: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={`spot-journal-${field}`}>
      {options.map((tag) => {
        const on = selected.includes(tag)
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={on}
            data-testid={`spot-journal-${field}-${tag}`}
            onClick={() => onToggle(tag)}
            className={chipClass(on)}
          >
            {spotTagLabel(tag)}
          </button>
        )
      })}
    </div>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

function JournalEditor({
  entry,
  onSave,
  onDone,
}: {
  entry: SpotEntry
  onSave: SaveSpotJournal
  onDone: () => void
}) {
  // Seeded once: the popup unmounts on close, so every open starts from what is
  // currently stored for this entry.
  const initial = entry.journal ?? EMPTY_SPOT_JOURNAL
  const [draft, setDraft] = useState<SpotJournal>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (field: "why" | "feeling", tag: string) =>
    setDraft((d) => {
      const has = d[field].includes(tag)
      const next = has ? d[field].filter((t) => t !== tag) : [...d[field], tag]
      // Kept in vocabulary order so a re-save that changed nothing compares equal.
      const order = (field === "why" ? SPOT_WHY : SPOT_FEELINGS) as readonly string[]
      return { ...d, [field]: order.filter((t) => next.includes(t)) }
    })

  async function submit() {
    if (saving) return
    const unchanged =
      draft.planned === initial.planned &&
      draft.why.join() === initial.why.join() &&
      draft.feeling.join() === initial.feeling.join() &&
      draft.note.trim() === initial.note.trim()
    if (unchanged) {
      onDone()
      return
    }
    setSaving(true)
    setError(null)
    const err = await onSave(entry.id, draft)
    if (err) {
      setError(err)
      setSaving(false)
      return
    }
    onDone()
  }

  return (
    <div className="flex w-72 flex-col gap-3">
      <p className="text-xs font-semibold">
        Journal · <span className="font-mono">{entry.ticker}</span>{" "}
        <span className="font-normal text-muted-foreground">
          {entry.side} {entry.tradedAt.slice(0, 10)}
        </span>
      </p>

      <Section label="Planned?">
        <div className="flex gap-1.5" data-testid="spot-journal-planned">
          {([true, false] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              aria-pressed={draft.planned === v}
              data-testid={`spot-journal-planned-${v ? "yes" : "no"}`}
              // Clicking the chosen answer again clears it back to "not answered".
              onClick={() => setDraft((d) => ({ ...d, planned: d.planned === v ? null : v }))}
              className={chipClass(draft.planned === v)}
            >
              {v ? "Yes" : "No"}
            </button>
          ))}
        </div>
      </Section>

      <Section label="Why">
        <Chips field="why" options={SPOT_WHY} selected={draft.why}
          onToggle={(t) => toggle("why", t)} />
      </Section>

      <Section label="Feeling">
        <Chips field="feeling" options={SPOT_FEELINGS} selected={draft.feeling}
          onToggle={(t) => toggle("feeling", t)} />
      </Section>

      <Section label="Note">
        <textarea
          value={draft.note}
          maxLength={MAX_SPOT_NOTE_LENGTH}
          onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          onKeyDown={(e) => {
            // Enter alone inserts a newline; ⌘/Ctrl+Enter saves.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
          rows={3}
          data-testid="spot-journal-note"
          placeholder="Anything worth remembering"
          // Fixed at three lines; longer notes scroll inside the box.
          className="block w-full resize-none overflow-y-auto rounded-md border border-input bg-background px-2 py-1.5 text-xs leading-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-right text-[10px] text-muted-foreground">
          {draft.note.length}/{MAX_SPOT_NOTE_LENGTH}
        </p>
      </Section>

      {error && (
        <p className="text-[11px] text-destructive" data-testid="spot-journal-error">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">⌘↵ to save</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDone}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            data-testid="spot-journal-save"
            className="flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/** The journal icon on a spot row. Accented once anything has been written. */
export function SpotJournalButton({
  entry,
  onSave,
  disabled,
}: {
  entry: SpotEntry
  onSave: SaveSpotJournal
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const filled = hasSpotJournal(entry.journal)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        disabled={disabled}
        data-testid="spot-journal-open"
        data-filled={filled ? "true" : "false"}
        aria-label={`Journal for ${entry.side} ${entry.ticker} entry${filled ? " (filled in)" : ""}`}
        title={filled ? "Journal — click to edit" : "Journal — planned, why, feeling"}
        className={`inline-flex items-center justify-center rounded p-1 align-middle transition-colors disabled:pointer-events-none disabled:opacity-40 ${
          filled
            ? "text-sky-500 hover:bg-sky-500/15"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        <NotebookPen className="h-3.5 w-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="left" align="center" sideOffset={6} className="z-50">
          <Popover.Popup
            data-testid="spot-journal-popup"
            className="rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
          >
            <JournalEditor entry={entry} onSave={onSave} onDone={() => setOpen(false)} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
