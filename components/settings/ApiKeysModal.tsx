'use client'

import { useState } from 'react'
import { Settings, X, Eye, EyeOff } from 'lucide-react'
import { useUserStore } from '@/lib/store/userStore'
import { ClientApiKeys } from '@/lib/exchanges/client'

interface ExchangeSection {
  label: string
  fields: { key: keyof ClientApiKeys; placeholder: string; label: string }[]
}

const EXCHANGES: ExchangeSection[] = [
  {
    label: 'Binance',
    fields: [
      { key: 'binanceApiKey', label: 'API Key', placeholder: 'Binance API key' },
      { key: 'binanceApiSecret', label: 'API Secret', placeholder: 'Binance API secret' },
    ],
  },
  {
    label: 'Bybit',
    fields: [
      { key: 'bybitApiKey', label: 'API Key', placeholder: 'Bybit API key' },
      { key: 'bybitApiSecret', label: 'API Secret', placeholder: 'Bybit API secret' },
    ],
  },
  {
    label: 'BingX',
    fields: [
      { key: 'bingxApiKey', label: 'API Key', placeholder: 'BingX API key' },
      { key: 'bingxApiSecret', label: 'API Secret', placeholder: 'BingX API secret' },
    ],
  },
  {
    label: 'MEXC',
    fields: [
      { key: 'mexcApiKey', label: 'API Key', placeholder: 'MEXC API key' },
      { key: 'mexcApiSecret', label: 'API Secret', placeholder: 'MEXC API secret' },
    ],
  },
  {
    label: 'OKX',
    fields: [
      { key: 'okxApiKey', label: 'API Key', placeholder: 'OKX API key' },
      { key: 'okxApiSecret', label: 'API Secret', placeholder: 'OKX API secret' },
      { key: 'okxPassphrase', label: 'Passphrase', placeholder: 'OKX passphrase' },
    ],
  },
  {
    label: 'Bitunix',
    fields: [
      { key: 'bitunixApiKey', label: 'API Key', placeholder: 'Bitunix API key' },
      { key: 'bitunixApiSecret', label: 'API Secret', placeholder: 'Bitunix API secret' },
    ],
  },
  {
    label: 'BYDFi',
    fields: [
      { key: 'bydfiApiKey', label: 'API Key', placeholder: 'BYDFi API key' },
      { key: 'bydfiApiSecret', label: 'API Secret', placeholder: 'BYDFi API secret' },
    ],
  },
]

export function ApiKeysModal() {
  const [open, setOpen] = useState(false)
  const { apiKeys, setApiKeys } = useUserStore()
  const [draft, setDraft] = useState<ClientApiKeys>(apiKeys)
  const [revealed, setRevealed] = useState<Partial<Record<keyof ClientApiKeys, boolean>>>({})

  function handleOpen() {
    setDraft(apiKeys)
    setOpen(true)
  }

  function handleSave() {
    const trimmed = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, v.trim()])
    ) as ClientApiKeys
    setApiKeys(trimmed)
    setOpen(false)
  }

  function handleCancel() {
    setDraft(apiKeys)
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className="rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Exchange API keys"
      >
        <Settings className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-16 px-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Exchange API Keys</h2>
          <button
            onClick={handleCancel}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-6">
          <p className="text-xs text-muted-foreground">
            Keys are stored only in your browser (localStorage). Use <strong>read-only</strong> API keys — no withdrawal permissions needed.
          </p>

          {EXCHANGES.map((exchange) => (
            <div key={exchange.label}>
              <p className="text-sm font-medium mb-2">{exchange.label}</p>
              <div className="space-y-2">
                {exchange.fields.map((field) => (
                  <div key={field.key}>
                    <label className="text-xs text-muted-foreground block mb-1">
                      {field.label}
                    </label>
                    <div className="relative">
                      <input
                        type={revealed[field.key] ? 'text' : 'password'}
                        autoComplete="off"
                        value={draft[field.key]}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        placeholder={field.placeholder}
                        className="w-full rounded-md border border-input bg-background px-3 py-1.5 pr-9 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                      />
                      <button
                        type="button"
                        onClick={() => setRevealed((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                      >
                        {revealed[field.key]
                          ? <EyeOff className="h-3.5 w-3.5" />
                          : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <button
            onClick={handleCancel}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-md px-4 py-2 text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
