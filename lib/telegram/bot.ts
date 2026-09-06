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

export type ParseMode = 'MarkdownV2' | 'HTML' | 'Markdown'

export async function sendMessage(
  chatId: number,
  text: string,
  parseMode?: ParseMode
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      // Telegram fetches every URL it sends in order to build a preview card.
      // For a one-shot login link that fetch REDEEMS the token — the crawler got
      // the session and the user got "?auth=expired" a moment later. Measured at
      // ~450ms after the message was sent. Previews must stay off on this bot.
      link_preview_options: { is_disabled: true },
      // Older Bot API name for the same thing, harmless alongside it.
      disable_web_page_preview: true,
    }),
  })
}
