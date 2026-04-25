'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useUserStore } from '@/lib/store/userStore'

export default function AuthPage() {
  const router = useRouter()
  const params = useSearchParams()
  const setTelegramUser = useUserStore((s) => s.setTelegramUser)

  useEffect(() => {
    const id = params.get('id')
    const name = params.get('name')
    if (id && name) {
      setTelegramUser(id, decodeURIComponent(name))
    }
    router.replace('/')
  }, [params, router, setTelegramUser])

  return null
}
