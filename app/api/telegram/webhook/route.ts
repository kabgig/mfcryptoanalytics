import { NextRequest, NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { sendMessage } from '@/lib/telegram/bot'
import type { TelegramUpdate } from '@/lib/telegram/bot'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const update: TelegramUpdate = await req.json()

  const message = update.message
  if (!message?.text?.startsWith('/start') || !message.from) {
    return NextResponse.json({ ok: true })
  }

  const telegramId = message.from.id
  const telegramName = message.from.first_name

  const sql = getSql()
  await sql`
    INSERT INTO users (telegram_id, telegram_name)
    VALUES (${telegramId}, ${telegramName})
    ON CONFLICT (telegram_id) DO NOTHING
  `

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const link = `${appUrl}/auth?id=${telegramId}&name=${encodeURIComponent(telegramName)}`

  await sendMessage(message.chat.id, `Go to the app: ${link}\n\nOn mobile, copy and paste it manually into your browser.`)

  return NextResponse.json({ ok: true })
}
