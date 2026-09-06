'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Dead end, kept deliberately.
 *
 * This page used to be the login: it read `?id=` and `?name=` straight from the
 * URL and wrote them into the client store, which meant anyone who knew a
 * Telegram id could become that user. Sign-in now goes through
 * /api/auth/exchange with a one-shot token, so old links in people's Telegram
 * history must land somewhere harmless rather than continue to work.
 */
export default function AuthPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/?auth=expired')
  }, [router])

  return null
}
