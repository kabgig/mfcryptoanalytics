import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ClientApiKeys } from '@/lib/exchanges/client'

interface OriginalAdmin {
  telegramId: string
  telegramName: string
  role: 'ADMIN' | 'USER'
  apiKeys: ClientApiKeys
}

interface UserState {
  userId: string | null
  walletAddress: string | null
  telegramId: string | null
  telegramName: string | null
  role: 'ADMIN' | 'USER' | null
  apiKeys: ClientApiKeys
  originalAdmin: OriginalAdmin | null
}

interface UserStore extends UserState {
  setUser: (data: Partial<UserState>) => void
  setTelegramUser: (telegramId: string, telegramName: string) => void
  setRole: (role: 'ADMIN' | 'USER') => void
  setApiKeys: (keys: Partial<ClientApiKeys>) => void
  clear: () => void
  startImpersonation: (target: { telegramId: string; telegramName: string; role: 'ADMIN' | 'USER' }) => void
  stopImpersonation: () => void
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
  originalAdmin: null,
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
      startImpersonation: (target) =>
        set((state) => ({
          ...state,
          originalAdmin: state.originalAdmin ?? {
            telegramId: state.telegramId!,
            telegramName: state.telegramName!,
            role: state.role as 'ADMIN' | 'USER',
            apiKeys: state.apiKeys,
          },
          telegramId: target.telegramId,
          telegramName: target.telegramName,
          role: target.role,
          apiKeys: emptyKeys,
        })),
      stopImpersonation: () =>
        set((state) => ({
          ...state,
          telegramId: state.originalAdmin?.telegramId ?? state.telegramId,
          telegramName: state.originalAdmin?.telegramName ?? state.telegramName,
          role: state.originalAdmin?.role ?? state.role,
          apiKeys: state.originalAdmin?.apiKeys ?? state.apiKeys,
          originalAdmin: null,
        })),
    }),
    { name: 'mfca-user-store' }
  )
)
