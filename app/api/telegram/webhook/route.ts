import { NextRequest, NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { sendMessage } from '@/lib/telegram/bot'
import type { TelegramUpdate } from '@/lib/telegram/bot'
import { enforceBodyLimit } from '@/lib/api/body-limit'
import { serverError } from '@/lib/api/errors'
import { isValidWebhookSecret } from '@/lib/api/webhook-auth'
import { createLoginToken } from '@/lib/auth/session'

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isValidWebhookSecret(req.headers.get('x-telegram-bot-api-secret-token'))) {
    console.warn('[telegram/webhook] rejected: bad or missing secret token')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tooLarge = enforceBodyLimit(req)
  if (tooLarge) return tooLarge as NextResponse

  let update: TelegramUpdate
  try {
    update = await req.json()
  } catch {
    // Previously an unparseable body threw out of the handler as a 500.
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const message = update.message
  if (!message?.text?.startsWith('/start') || !message.from) {
    return NextResponse.json({ ok: true })
  }

  const telegramId = message.from.id
  const telegramName = message.from.first_name

  try {
    const sql = getSql()
    // RETURNING on the conflict path too, so an existing user still yields an id.
    const rows = await sql`
      INSERT INTO public.users (telegram_id, telegram_name)
      VALUES (${telegramId}, ${telegramName})
      ON CONFLICT (telegram_id) DO UPDATE SET telegram_name = EXCLUDED.telegram_name
      RETURNING id
    ` as { id: string }[]

    // The link now carries a one-shot, 10-minute token instead of the user's own
    // id. Knowing someone's Telegram id is no longer enough to become them, and
    // a link that leaks later is already spent or expired.
    const token = await createLoginToken(rows[0].id)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const link = `${appUrl}/api/auth/exchange?token=${token}`

    await sendMessage(
      message.chat.id,
      `Sign in: ${link}\n\nThis link works once and expires in 10 minutes.\nOn mobile, copy and paste it manually into your browser.`
    )
  } catch (err) {
    return serverError('telegram/webhook', err) as NextResponse
  }

  return NextResponse.json({ ok: true })
}
