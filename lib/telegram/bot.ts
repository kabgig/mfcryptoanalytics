export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
}

export interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: { id: number; type: string }
  text?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

interface InlineKeyboardButton {
  text: string
  url?: string
}

export async function sendMessage(
  chatId: number,
  text: string,
  inlineKeyboard?: InlineKeyboardButton[][],
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return

  const body: Record<string, unknown> = { chat_id: chatId, text }
  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard }
  }

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
