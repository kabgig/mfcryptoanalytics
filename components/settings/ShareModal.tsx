'use client'

import { useState, useEffect, useCallback } from 'react'
import { Share2, Copy, Trash2, RefreshCw, X, Check } from 'lucide-react'
import { useUserStore } from '@/lib/store/userStore'

interface ShareModalProps {
  trigger?: React.ReactNode
}

export function ShareModal({ trigger }: ShareModalProps) {
  const telegramId = useUserStore((s) => s.telegramId)
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const shareUrl = token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${token}`
    : null

  const fetchToken = useCallback(async () => {
    if (!telegramId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/user/share-token?telegramId=${telegramId}`)
      const data = await res.json()
      setToken(data.token ?? null)
    } finally {
      setLoading(false)
    }
  }, [telegramId])

  useEffect(() => {
    if (open) fetchToken()
  }, [open, fetchToken])

  const generate = async () => {
    if (!telegramId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/user/share-token?telegramId=${telegramId}`, {
        method: 'POST',
      })
      const data = await res.json()
      setToken(data.token ?? null)
    } finally {
      setLoading(false)
    }
  }

  const revoke = async () => {
    if (!telegramId) return
    setLoading(true)
    try {
      await fetch(`/api/user/share-token?telegramId=${telegramId}`, { method: 'DELETE' })
      setToken(null)
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!telegramId) return null

  return (
    <>
      {trigger ? (
        <div onClick={() => setOpen(true)} className="cursor-pointer w-full">
          {trigger}
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
          title="Share PnL"
        >
          <Share2 className="h-4 w-4" />
          Share
        </button>
      )}

      {open && (
        <div className="fixed inset-x-0 bottom-0 top-14 z-40 flex items-start justify-center pt-6 px-4">
          <div className="relative z-[41] w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4" />
                <h2 className="text-base font-semibold">Share PnL</h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm text-muted-foreground mb-5">
              Anyone with the link can view your PnL stats. Your name, Telegram ID, and API keys are never exposed.
            </p>

            {loading ? (
              <div className="flex justify-center py-6">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : token ? (
              <div className="space-y-3">
                {/* URL display */}
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
                  <span className="flex-1 truncate text-xs text-muted-foreground font-mono">
                    {shareUrl}
                  </span>
                  <button
                    onClick={copy}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title="Copy link"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={copy}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Copied!' : 'Copy link'}
                  </button>
                  <button
                    onClick={generate}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
                    title="Generate new link (invalidates the old one)"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Regenerate
                  </button>
                  <button
                    onClick={revoke}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-destructive/50 bg-background px-3 py-2 text-sm font-medium text-destructive shadow-sm hover:bg-destructive/10"
                    title="Revoke link"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={generate}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                <Share2 className="h-4 w-4" />
                Generate share link
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
