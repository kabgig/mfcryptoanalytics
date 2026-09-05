/**
 * Run once after deploying to register the webhook with Telegram:
 *   TELEGRAM_BOT_TOKEN=<token> NEXT_PUBLIC_APP_URL=<url> \
 *   TELEGRAM_WEBHOOK_SECRET=<secret> npx tsx scripts/set-webhook.ts
 *
 * The secret is echoed back by Telegram on every update in the
 * X-Telegram-Bot-Api-Secret-Token header, and the webhook route rejects any
 * request that does not carry it. Registering without it locks the bot out.
 */

const token = process.env.TELEGRAM_BOT_TOKEN
const appUrl = process.env.NEXT_PUBLIC_APP_URL
const secret = process.env.TELEGRAM_WEBHOOK_SECRET

if (!token || !appUrl) {
  console.error('TELEGRAM_BOT_TOKEN and NEXT_PUBLIC_APP_URL must be set')
  process.exit(1)
}

if (!secret) {
  console.error(
    'TELEGRAM_WEBHOOK_SECRET must be set — the webhook route rejects every\n' +
    'update that does not echo it back. Generate one with:\n' +
    '  openssl rand -hex 32'
  )
  process.exit(1)
}

const webhookUrl = `${appUrl}/api/telegram/webhook`

fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: webhookUrl, secret_token: secret }),
})
  .then((r) => r.json())
  .then((data) => {
    console.log('setWebhook response:', data)
  })
  .catch((err) => {
    console.error('Failed to set webhook:', err)
    process.exit(1)
  })
