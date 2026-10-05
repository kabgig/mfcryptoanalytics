import { create } from 'zustand'

export interface RefreshTarget {
  run: () => void
  busy: boolean
  /** What the click reloads, e.g. "prices" — used for the button's label. */
  label: string
}

interface RefreshStore {
  target: RefreshTarget | null
  owner: object | null
  register: (owner: object, target: RefreshTarget) => void
  release: (owner: object) => void
}

/**
 * The navbar's refresh button. Each page registers what a click should reload;
 * pages that register nothing get no button. Not persisted — a registration
 * only means something while its page is mounted.
 *
 * `release` is owner-checked: during a client navigation the outgoing page's
 * cleanup must not clear what the incoming page has already registered.
 */
export const useRefreshStore = create<RefreshStore>()((set, get) => ({
  target: null,
  owner: null,
  register: (owner, target) => set({ owner, target }),
  release: (owner) => {
    if (get().owner === owner) set({ owner: null, target: null })
  },
}))
