"use client"

import { useEffect, useRef, useState } from "react"
import { CalendarRange } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DASHBOARD_PERIODS,
  DEFAULT_PERIOD,
  PERIODS,
  VIZ_PERIODS,
  selectionLabel,
  todayIso,
  type Period,
  type PeriodLabel,
  type PeriodSelection,
} from "@/lib/constants/periods"

/** Class overrides for the `viz` variant, which uses its own mono light/dark palette. */
export interface PeriodSelectorClasses {
  button?: string
  active?: string
  inactive?: string
  panel?: string
  input?: string
  apply?: string
  clear?: string
}

interface PeriodSelectorProps {
  value: PeriodSelection
  onChange: (selection: PeriodSelection) => void
  variant?: "dashboard" | "viz"
  /** Presets to show. Defaults to the list this variant has always offered. */
  periods?: Period[]
  /** Only used by the `viz` variant. */
  classes?: PeriodSelectorClasses
  /** Called after a selection is applied — lets the viz mobile menu close itself. */
  onApplied?: () => void
  className?: string
}

const CUSTOM_OPTION = "__custom__"

export function PeriodSelector({
  value,
  onChange,
  variant = "dashboard",
  periods,
  classes,
  onApplied,
  className,
}: PeriodSelectorProps) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState("")
  const [draftTo, setDraftTo] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)

  const isCustom = value.kind === "custom"

  // The selection is shared across pages, so a preset picked elsewhere may not be
  // in this variant's list (e.g. "All" from the viz pages). Show it rather than
  // leaving the group with nothing highlighted.
  const base = periods ?? (variant === "viz" ? VIZ_PERIODS : DASHBOARD_PERIODS)
  const visiblePeriods =
    !isCustom && !base.some((p) => p.label === value.label)
      ? [...base, PERIODS.find((p) => p.label === value.label)!]
      : base

  // Close the popover on outside click / Escape
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("touchstart", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("touchstart", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  function openPicker() {
    setDraftFrom(value.kind === "custom" ? value.from : "")
    setDraftTo(value.kind === "custom" ? value.to : "")
    setOpen(true)
  }

  function togglePicker() {
    if (open) setOpen(false)
    else openPicker()
  }

  function selectPreset(label: PeriodLabel) {
    onChange({ kind: "preset", label })
    setOpen(false)
    onApplied?.()
  }

  const canApply = draftFrom !== "" && draftTo !== "" && draftFrom <= draftTo

  function apply() {
    if (!canApply) return
    onChange({ kind: "custom", from: draftFrom, to: draftTo })
    setOpen(false)
    onApplied?.()
  }

  function clear() {
    onChange(DEFAULT_PERIOD)
    setDraftFrom("")
    setDraftTo("")
    setOpen(false)
    onApplied?.()
  }

  const today = todayIso()

  const panelClass =
    classes?.panel ??
    "rounded-lg border bg-background shadow-lg p-3 space-y-2 text-sm"
  const inputClass =
    classes?.input ??
    "w-full rounded-md border bg-muted/40 px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
  const applyClass =
    classes?.apply ??
    "flex-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
  const clearClass =
    classes?.clear ??
    "rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"

  const picker = (
    <div className={`absolute right-0 top-full z-50 mt-2 w-64 ${panelClass}`}>
      <label className="block">
        <span className="mb-1 block text-xs opacity-70">From</span>
        <input
          type="date"
          value={draftFrom}
          max={draftTo || today}
          onChange={(e) => setDraftFrom(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs opacity-70">To</span>
        <input
          type="date"
          value={draftTo}
          min={draftFrom || undefined}
          max={today}
          onChange={(e) => setDraftTo(e.target.value)}
          className={inputClass}
        />
      </label>
      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={apply} disabled={!canApply} className={applyClass}>
          Apply
        </button>
        <button type="button" onClick={clear} className={clearClass}>
          Clear
        </button>
      </div>
      <p className="pt-1 text-[11px] leading-snug opacity-50">
        Only cached trade history is available — ranges older than that may come back empty.
      </p>
    </div>
  )

  if (variant === "viz") {
    const btn = classes?.button ?? "px-2.5 py-1 text-xs font-mono rounded transition-all"
    return (
      <div ref={containerRef} className={cn("relative flex items-center gap-1.5", className)}>
        {visiblePeriods.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => selectPreset(p.label)}
            className={`${btn} ${
              !isCustom && value.label === p.label ? classes?.active ?? "" : classes?.inactive ?? ""
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={togglePicker}
          title="Custom date range"
          className={`${btn} flex items-center gap-1 ${
            isCustom ? classes?.active ?? "" : classes?.inactive ?? ""
          }`}
        >
          <CalendarRange className="h-3.5 w-3.5" />
          {isCustom ? selectionLabel(value) : null}
        </button>
        {open && picker}
      </div>
    )
  }

  return (
    <div ref={containerRef} className={cn("relative flex items-center gap-2", className)}>
      {/* Mobile: dropdown */}
      <div className="relative sm:hidden">
        <select
          value={isCustom ? CUSTOM_OPTION : value.label}
          onChange={(e) => {
            if (e.target.value === CUSTOM_OPTION) openPicker()
            else selectPreset(e.target.value as PeriodLabel)
          }}
          className="appearance-none rounded-lg border bg-muted/40 pl-2 pr-7 py-1.5 text-sm font-medium text-foreground focus:outline-none"
        >
          {visiblePeriods.map(({ label }) => (
            <option key={label} value={label}>{label}</option>
          ))}
          <option value={CUSTOM_OPTION}>
            {isCustom ? selectionLabel(value) : "Custom…"}
          </option>
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
          <svg className="h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      {/* Desktop: pill group */}
      <div className="hidden sm:flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
        {visiblePeriods.map(({ label }) => (
          <button
            key={label}
            type="button"
            onClick={() => selectPreset(label)}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              !isCustom && value.label === label
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={togglePicker}
          title="Custom date range"
          className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors ${
            isCustom
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <CalendarRange className="h-3.5 w-3.5" />
          {isCustom ? selectionLabel(value) : "Custom"}
        </button>
      </div>

      {open && picker}
    </div>
  )
}
