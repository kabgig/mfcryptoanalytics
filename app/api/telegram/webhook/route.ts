import { NextRequest, NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { sendMessage } from '@/lib/telegram/bot'
import type { TelegramUpdate } from '@/lib/telegram/bot'
import { enforceBodyLimit } from '@/lib/api/body-limit'
import { serverError } from '@/lib/api/errors'
import { isValidWebhookSecret } from '@/lib/api/webhook-auth'

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
    await sql`
      INSERT INTO users (telegram_id, telegram_name)
      VALUES (${telegramId}, ${telegramName})
      ON CONFLICT (telegram_id) DO NOTHING
    `

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const link = `${appUrl}/auth?id=${telegramId}&name=${encodeURIComponent(telegramName)}`

    await sendMessage(message.chat.id, `Go to the app: ${link}\n\nOn mobile, copy and paste it manually into your browser.`)
  } catch (err) {
    return serverError('telegram/webhook', err) as NextResponse
  }

  return NextResponse.json({ ok: true })
}
