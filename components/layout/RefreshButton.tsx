"use client"

import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRefreshStore } from "@/lib/store/refreshStore"

/** Reloads whatever the current page registered via useNavbarRefresh. */
export function RefreshButton() {
  const target = useRefreshStore((s) => s.target)
  if (!target) return null

  return (
    <Button
      variant="ghost"
      size="icon"
      className="w-9 h-9"
      onClick={target.run}
      disabled={target.busy}
      aria-label={`Refresh ${target.label}`}
      title={`Refresh ${target.label}`}
      data-testid="nav-refresh"
      data-busy={target.busy ? "true" : "false"}
    >
      <RefreshCw className={`h-4 w-4 ${target.busy ? "animate-spin" : ""}`} />
    </Button>
  )
}
