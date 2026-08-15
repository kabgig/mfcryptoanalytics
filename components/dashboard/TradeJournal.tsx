"use client"

import { useState } from "react"
import { Popover } from "@base-ui/react/popover"
import { ChevronLeft, ChevronRight, Circle, Loader2 } from "lucide-react"
import type { Trade, TradeNotePhase, TradeNotes } from "@/types"

const MAX_NOTE_LENGTH = 4000

/**
 * Icon, label and tooltip wording for each journalling moment. The order here is
 * the order the icons render in, and it reads as a timeline: ‹ entry ● hold › exit.
 */
const PHASES: {
  phase: TradeNotePhase
  label: string
  hint: string
  Icon: typeof ChevronLeft
}[] = [
  { phase: "before", label: "Before", hint: "Before the trade — thesis, setup, plan", Icon: ChevronLeft },
  { phase: "during", label: "During", hint: "During the trade — how it played out", Icon: Circle },
  { phase: "after", label: "After", hint: "After the trade — outcome, lesson", Icon: ChevronRight },
]

interface TradeJournalProps {
  trade: Trade
  notes: TradeNotes
  /** Resolves once the note is persisted; rejects to surface a save error. */
  onSave: (trade: Trade, phase: TradeNotePhase, body: string) => Promise<void>
  /** Deleted rows are read-only — the journal survives, but cannot be edited. */
  disabled?: boolean
}

function NoteEditor({
  trade,
  phase,
  label,
  hint,
  initial,
  onSave,
  onDone,
}: {
  trade: Trade
  phase: TradeNotePhase
  label: string
  hint: string
  initial: string
  onSave: TradeJournalProps["onSave"]
  onDone: () => void
}) {
  // Seeded once, because the popup unmounts on close: every open mounts a fresh
  // editor already holding whatever is currently stored for this phase.
  const [text, setText] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (saving) return
    // Nothing typed and nothing stored: close without a pointless round trip.
    if (text.trim() === initial.trim()) {
      onDone()
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(trade, phase, text)
      onDone()
    } catch (err) {
      setError(String(err))
      setSaving(false)
    }
  }

  return (
    <div className="flex w-80 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold">
          {label} · <span className="font-mono">{trade.ticker}</span>
        </span>
        <span className="text-[10px] text-muted-foreground">
          {text.length}/{MAX_NOTE_LENGTH}
        </span>
      </div>
      <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>
      <textarea
        autoFocus
        value={text}
        maxLength={MAX_NOTE_LENGTH}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter alone inserts a newline — journal entries are multi-line.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
        rows={5}
        data-testid="note-textarea"
        placeholder="What were you thinking?"
        className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {error && <p className="text-[11px] text-destructive">{error}</p>}
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
            data-testid="note-save"
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

/**
 * The three journal icons on a trade row. An icon is filled and accented once a
 * note exists for that phase, so a glance down the column shows which trades
 * have been written up.
 */
export function TradeJournal({ trade, notes, onSave, disabled }: TradeJournalProps) {
  const [openPhase, setOpenPhase] = useState<TradeNotePhase | null>(null)

  return (
    <div className="flex items-center gap-0.5">
      {PHASES.map(({ phase, label, hint, Icon }) => {
        const body = notes[phase] ?? ""
        const filled = body.trim().length > 0
        return (
          <Popover.Root
            key={phase}
            open={openPhase === phase}
            onOpenChange={(open) => setOpenPhase(open ? phase : null)}
          >
            <Popover.Trigger
              type="button"
              disabled={disabled}
              data-testid={`note-${phase}`}
              data-filled={filled ? "true" : "false"}
              aria-label={`${label} note for ${trade.ticker} trade${filled ? " (has note)" : ""}`}
              // The stored text is the tooltip, so a note can be read without
              // opening anything.
              title={filled ? `${label}: ${body}` : hint}
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors disabled:pointer-events-none disabled:opacity-40 ${
                filled
                  ? "text-sky-500 hover:bg-sky-500/15"
                  : "text-muted-foreground/40 hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon
                className={phase === "during" ? "h-2.5 w-2.5" : "h-4 w-4"}
                {...(phase === "during" && filled ? { fill: "currentColor" } : {})}
              />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner side="top" align="center" sideOffset={6} className="z-50">
                <Popover.Popup
                  data-testid="note-popup"
                  className="rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
                >
                  <NoteEditor
                    trade={trade}
                    phase={phase}
                    label={label}
                    hint={hint}
                    initial={body}
                    onSave={onSave}
                    onDone={() => setOpenPhase(null)}
                  />
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        )
      })}
    </div>
  )
}
