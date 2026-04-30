"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useUserStore } from "@/lib/store/userStore"
import { Navbar } from "@/components/layout/Navbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RefreshCw } from "lucide-react"

interface UserRow {
  telegramId: string
  telegramName: string
  role: string
  createdAt: string
  tradeCount: number
  exchangeCount: number
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

export default function AdminPage() {
  const role = useUserStore((s) => s.role)
  const telegramId = useUserStore((s) => s.telegramId)
  const router = useRouter()

  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (telegramId !== null && role !== null && role !== "ADMIN") {
      router.replace("/")
    }
  }, [role, telegramId, router])

  const fetchUsers = () => {
    setLoading(true)
    setError(null)
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error)
        setUsers(data as UserRow[])
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (role === "ADMIN") fetchUsers()
  }, [role])

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

  const totalTrades = users.reduce((s, u) => s + u.tradeCount, 0)

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
          <button
            onClick={fetchUsers}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card className="text-center">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total users</p>
              <p className="mt-0.5 text-xl font-semibold">{users.length}</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Cached trades</p>
              <p className="mt-0.5 text-xl font-semibold">{totalTrades.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card className="text-center col-span-2 sm:col-span-1">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Avg trades / user</p>
              <p className="mt-0.5 text-xl font-semibold">
                {users.length > 0 ? Math.round(totalTrades / users.length).toLocaleString() : "—"}
              </p>
            </CardContent>
          </Card>
        </div>

        {error && (
          <div className="rounded-lg border border-red-400/50 bg-red-400/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Users</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading && users.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Loading…</div>
            ) : users.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">No users found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Name</th>
                      <th className="px-4 py-2.5 font-medium">Telegram ID</th>
                      <th className="px-4 py-2.5 font-medium">Role</th>
                      <th className="px-4 py-2.5 font-medium">Joined</th>
                      <th className="px-4 py-2.5 font-medium text-right">Trades</th>
                      <th className="px-4 py-2.5 font-medium text-right">Exchanges</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.telegramId} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 font-medium">{u.telegramName}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{u.telegramId}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.role === "ADMIN"
                              ? "bg-violet-400/15 text-violet-600 dark:text-violet-400"
                              : "bg-muted text-muted-foreground"
                          }`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(u.createdAt)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{u.tradeCount.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{u.exchangeCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
