import { timingSafeEqual } from "node:crypto"

/**
 * Constant-time check of the secret Telegram echoes back on every update, in the
 * X-Telegram-Bot-Api-Secret-Token header.
 *
 * Without it, anyone who knows the webhook URL can POST a forged update — which
 * creates a `users` row and makes the bot deliver a message to a chat id of
 * their choosing.
 *
 * A missing env var rejects everything rather than waving requests through: an
 * unconfigured deployment must fail closed. It lives here rather than in the
 * route so it can be unit-tested without importing a Next handler.
 */
export function isValidWebhookSecret(
  received: string | null,
  expected: string | undefined = process.env.TELEGRAM_WEBHOOK_SECRET
): boolean {
  if (!expected || received === null || received === "") return false

  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, so lengths are compared first.
  // Length is not the secret; the bytes are.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
