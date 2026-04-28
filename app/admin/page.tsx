"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useUserStore } from "@/lib/store/userStore"
import { Navbar } from "@/components/layout/Navbar"

export default function AdminPage() {
  const role = useUserStore((s) => s.role)
  const telegramId = useUserStore((s) => s.telegramId)
  const router = useRouter()

  useEffect(() => {
    // Redirect non-admins. Allow null role (still loading) to stay momentarily.
    if (telegramId !== null && role !== null && role !== "ADMIN") {
      router.replace("/")
    }
  }, [role, telegramId, router])

  // Not logged in or role not loaded yet
  if (!telegramId || role === null) {
    return (
      <div className="flex flex-col min-h-screen">
        <Navbar />
        <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading…
        </main>
      </div>
    )
  }

  if (role !== "ADMIN") return null

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">Admin tools and controls will appear here.</p>
      </main>
    </div>
  )
}
