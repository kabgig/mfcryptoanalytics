import * as React from "react"
import { cn } from "@/lib/utils"

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <span className={cn("relative group/tip cursor-default", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 bottom-full left-0 mb-2",
          "opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150",
          "bg-popover text-popover-foreground text-xs rounded-md px-3 py-2 shadow-md",
          "w-52 whitespace-normal border border-border leading-relaxed"
        )}
      >
        {content}
      </span>
    </span>
  )
}
