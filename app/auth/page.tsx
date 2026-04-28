'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useUserStore } from '@/lib/store/userStore'

export default function AuthPage() {
  const router = useRouter()
  const params = useSearchParams()
  const setTelegramUser = useUserStore((s) => s.setTelegramUser)
  const setRole = useUserStore((s) => s.setRole)

  useEffect(() => {
    const id = params.get('id')
    const name = params.get('name')
    if (id && name) {
      setTelegramUser(id, decodeURIComponent(name))
      fetch(`/api/user/role?telegramId=${id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.role === 'ADMIN' || data.role === 'USER') {
            setRole(data.role)
          }
        })
        .catch(() => {/* role stays null, non-critical */})
    }
    router.replace('/')
  }, [params, router, setTelegramUser, setRole])

  return null
}
