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
  /** False until /api/me has answered. Guards against flashing the landing page. */
  hydrated: boolean
  /** True while an admin is viewing the app as another user. */
  impersonating: boolean
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
  /** Applies the authoritative answer from /api/me. */
  setSession: (data: {
    telegramId: string
    telegramName: string
    role: 'ADMIN' | 'USER'
    impersonating: boolean
  }) => void
  /** /api/me said 401: drop cached identity but keep locally-held API keys. */
  clearSession: () => void
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
  hydrated: false,
  impersonating: false,
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
      setSession: ({ telegramId, telegramName, role, impersonating }) =>
        set((state) => ({ ...state, telegramId, telegramName, role, impersonating, hydrated: true })),
      clearSession: () =>
        set((state) => ({
          ...state,
          telegramId: null, telegramName: null, role: null,
          impersonating: false, originalAdmin: null, hydrated: true,
        })),
      setTelegramUser: (telegramId, telegramName) => set((state) => ({ ...state, telegramId, telegramName })),
      setRole: (role) => set((state) => ({ ...state, role })),
      setApiKeys: (keys) =>
        set((state) => ({ ...state, apiKeys: { ...state.apiKeys, ...keys } })),
      clear: () => set((state) => ({ ...initialState, apiKeys: state.apiKeys })),
      // Impersonation is decided by the server (see /api/admin/impersonate);
      // these only mirror it locally so the UI can show who you are acting as.
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
          impersonating: true,
          apiKeys: emptyKeys,
        })),
      stopImpersonation: () =>
        set((state) => ({
          ...state,
          telegramId: state.originalAdmin?.telegramId ?? state.telegramId,
          telegramName: state.originalAdmin?.telegramName ?? state.telegramName,
          role: state.originalAdmin?.role ?? state.role,
          apiKeys: state.originalAdmin?.apiKeys ?? state.apiKeys,
          impersonating: false,
          originalAdmin: null,
        })),
    }),
    {
      name: 'mfca-user-store',
      // hydrated is deliberately excluded: every reload must re-ask /api/me
      // rather than trusting a cached "logged in" flag.
      partialize: (state) => ({
        userId: state.userId,
        walletAddress: state.walletAddress,
        telegramId: state.telegramId,
        telegramName: state.telegramName,
        role: state.role,
        apiKeys: state.apiKeys,
        originalAdmin: state.originalAdmin,
      }),
    }
  )
)
