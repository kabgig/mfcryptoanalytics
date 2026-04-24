import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ClientApiKeys } from '@/lib/exchanges/client'

interface UserState {
  userId: string | null
  walletAddress: string | null
  apiKeys: ClientApiKeys
}

interface UserStore extends UserState {
  setUser: (data: Partial<UserState>) => void
  setApiKeys: (keys: Partial<ClientApiKeys>) => void
  clear: () => void
}

const emptyKeys: ClientApiKeys = {
  binanceApiKey: '',
  binanceApiSecret: '',
  bybitApiKey: '',
  bybitApiSecret: '',
  bingxApiKey: '',
  bingxApiSecret: '',
  mexcApiKey: '',
  mexcApiSecret: '',
  okxApiKey: '',
  okxApiSecret: '',
  okxPassphrase: '',
}

const initialState: UserState = {
  userId: null,
  walletAddress: null,
  apiKeys: emptyKeys,
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      ...initialState,
      setUser: (data) => set((state) => ({ ...state, ...data })),
      setApiKeys: (keys) =>
        set((state) => ({ ...state, apiKeys: { ...state.apiKeys, ...keys } })),
      clear: () => set(initialState),
    }),
    { name: 'mfca-user-store' }
  )
)
