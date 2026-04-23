import { create } from 'zustand'

interface UserState {
  userId: string | null
  walletAddress: string | null
  binanceApiKey: string | null
  bybitApiKey: string | null
}

interface UserStore extends UserState {
  setUser: (data: Partial<UserState>) => void
  clear: () => void
}

const initialState: UserState = {
  userId: null,
  walletAddress: null,
  binanceApiKey: null,
  bybitApiKey: null,
}

export const useUserStore = create<UserStore>((set) => ({
  ...initialState,
  setUser: (data) => set((state) => ({ ...state, ...data })),
  clear: () => set(initialState),
}))
