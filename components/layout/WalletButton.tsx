'use client'

import { useEffect } from 'react'
import { useAppKit, useAppKitAccount } from '@reown/appkit/react'
import { Button } from '@/components/ui/button'
import { Wallet } from 'lucide-react'
import { useUserStore } from '@/lib/store/userStore'

export function WalletButton() {
  const { open } = useAppKit()
  const { address, isConnected } = useAppKitAccount()
  const setUser = useUserStore((s) => s.setUser)
  const clear = useUserStore((s) => s.clear)

  useEffect(() => {
    if (isConnected && address) {
      setUser({ walletAddress: address })
    } else {
      setUser({ walletAddress: null })
    }
  }, [isConnected, address, setUser, clear])

  const label = isConnected && address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : 'Connect Wallet'

  return (
    <Button variant="outline" size="sm" className="gap-2" onClick={() => open()}>
      <Wallet className="h-4 w-4" />
      {label}
    </Button>
  )
}
