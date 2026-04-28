import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ClientApiKeys } from '@/lib/exchanges/client'

interface UserState {
  userId: string | null
  walletAddress: string | null
  telegramId: string | null
  telegramName: string | null
  role: 'ADMIN' | 'USER' | null
  apiKeys: ClientApiKeys
}

interface UserStore extends UserState {
  setUser: (data: Partial<UserState>) => void
  setTelegramUser: (telegramId: string, telegramName: string) => void
  setRole: (role: 'ADMIN' | 'USER') => void
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
  bitunixApiKey: '',
  bitunixApiSecret: '',
  bydfiApiKey: '',
  bydfiApiSecret: '',
}

const initialState: UserState = {
  userId: null,
  walletAddress: null,
  telegramId: null,
  telegramName: null,
  role: null,
  apiKeys: emptyKeys,
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      ...initialState,
      setUser: (data) => set((state) => ({ ...state, ...data })),
      setTelegramUser: (telegramId, telegramName) => set((state) => ({ ...state, telegramId, telegramName })),
      setRole: (role) => set((state) => ({ ...state, role })),
      setApiKeys: (keys) =>
        set((state) => ({ ...state, apiKeys: { ...state.apiKeys, ...keys } })),
      clear: () => set((state) => ({ ...initialState, apiKeys: state.apiKeys })),
    }),
    { name: 'mfca-user-store' }
  )
)
