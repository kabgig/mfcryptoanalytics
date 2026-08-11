import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { DEFAULT_PERIOD, isValidSelection, type PeriodSelection } from '@/lib/constants/periods'

interface PeriodStore {
  selection: PeriodSelection
  setSelection: (selection: PeriodSelection) => void
  reset: () => void
}

/**
 * The selected timeframe, shared by every view that shows a period selector.
 * Persisted to sessionStorage so the interval carries across pages within a tab
 * without surviving a browser restart. Kept separate from the user store, which
 * persists auth state to localStorage.
 */
export const usePeriodStore = create<PeriodStore>()(
  persist(
    (set) => ({
      selection: DEFAULT_PERIOD,
      setSelection: (selection) => set({ selection }),
      reset: () => set({ selection: DEFAULT_PERIOD }),
    }),
    {
      name: 'mfca-period',
      storage: createJSONStorage(() => sessionStorage),
      // A stale or hand-edited value must never reach the filter helpers.
      onRehydrateStorage: () => (state) => {
        if (state && !isValidSelection(state.selection)) {
          state.selection = DEFAULT_PERIOD
        }
      },
    }
  )
)
