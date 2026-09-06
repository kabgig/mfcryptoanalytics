'use client'

import { useEffect } from 'react'
import { useUserStore } from '@/lib/store/userStore'

/**
 * Hydrates the client store from /api/me, which is the only thing that decides
 * who you are. The persisted store is now just a cache for a fast first paint:
 * if the cookie is gone or expired, /api/me answers 401 and the cached identity
 * is dropped rather than being trusted.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const setSession = useUserStore((s) => s.setSession)
  const clearSession = useUserStore((s) => s.clearSession)

  useEffect(() => {
    let cancelled = false

    fetch('/api/me')
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          clearSession()
          return
        }
        const data = await res.json()
        setSession({
          telegramId: String(data.telegramId),
          telegramName: data.telegramName ?? '',
          role: data.role === 'ADMIN' ? 'ADMIN' : 'USER',
          impersonating: Boolean(data.impersonating),
        })
      })
      // A network blip should not log anyone out; leave the cached identity and
      // let the next request's 401 settle it.
      .catch(() => {})

    return () => { cancelled = true }
  }, [setSession, clearSession])

  return <>{children}</>
}
