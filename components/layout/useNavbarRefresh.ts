'use client'

import { useEffect } from 'react'
import { useRefreshStore } from '@/lib/store/refreshStore'

/**
 * Puts this page's reload behind the navbar's refresh icon while the page is
 * mounted. Pass `run = null` to show no icon (signed out, not yet allowed).
 * Keep `run` stable (useCallback) — every new identity re-registers.
 */
export function useNavbarRefresh(run: (() => void) | null, busy: boolean, label: string) {
  useEffect(() => {
    if (!run) return
    const owner = {}
    const { register, release } = useRefreshStore.getState()
    register(owner, { run, busy, label })
    return () => release(owner)
  }, [run, busy, label])
}
