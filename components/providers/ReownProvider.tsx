'use client'

import { wagmiAdapter, projectId, networks } from '@/lib/reown/config'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAppKit } from '@reown/appkit/react'
import { mainnet } from '@reown/appkit/networks'
import { type ReactNode } from 'react'
import { cookieToInitialState, WagmiProvider, type Config } from 'wagmi'

const queryClient = new QueryClient()

createAppKit({
  adapters: [wagmiAdapter],
  projectId: projectId!,
  networks,
  defaultNetwork: mainnet,
  metadata: {
    name: 'MF Crypto Analytics',
    description: 'Track your PnL across multiple crypto exchanges',
    url: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
    icons: [],
  },
  features: {
    analytics: false,
  },
})

export function ReownProvider({
  children,
  cookies,
}: {
  children: ReactNode
  cookies: string | null
}) {
  const initialState = cookieToInitialState(wagmiAdapter.wagmiConfig as Config, cookies)

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig as Config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
