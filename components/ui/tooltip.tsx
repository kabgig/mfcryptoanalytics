import * as React from "react"
import { cn } from "@/lib/utils"

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  className?: string
  /** Position of the popup relative to the trigger. Defaults to "top". */
  side?: "top" | "bottom"
}

export function Tooltip({ content, children, className, side = "top" }: TooltipProps) {
  return (
    <span className={cn("relative group/tip", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 left-0 mb-2",
          "opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150",
          "bg-popover text-popover-foreground text-xs rounded-md px-3 py-2 shadow-md",
          "w-56 whitespace-normal border border-border leading-relaxed",
          side === "top" ? "bottom-full" : "top-full mt-2"
        )}
      >
        {content}
      </span>
    </span>
  )
}

/** A standalone ⓘ icon that shows a tooltip on hover. */
export function InfoTooltip({ content, className }: { content: React.ReactNode; className?: string }) {
  return (
    <Tooltip content={content} className={cn("inline-flex items-center cursor-help", className)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    </Tooltip>
  )
}
