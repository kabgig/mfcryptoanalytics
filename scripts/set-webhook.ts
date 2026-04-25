/**
 * Run once after deploying to register the webhook with Telegram:
 *   TELEGRAM_BOT_TOKEN=<token> NEXT_PUBLIC_APP_URL=<url> npx ts-node scripts/set-webhook.ts
 */

const token = process.env.TELEGRAM_BOT_TOKEN
const appUrl = process.env.NEXT_PUBLIC_APP_URL

if (!token || !appUrl) {
  console.error('TELEGRAM_BOT_TOKEN and NEXT_PUBLIC_APP_URL must be set')
  process.exit(1)
}

const webhookUrl = `${appUrl}/api/telegram/webhook`

fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: webhookUrl }),
})
  .then((r) => r.json())
  .then((data) => {
    console.log('setWebhook response:', data)
  })
  .catch((err) => {
    console.error('Failed to set webhook:', err)
    process.exit(1)
  })
