/**
 * Server-side exchange cooldowns, in Neon.
 *
 * Vercel functions share nothing in memory and scale to many concurrent
 * instances, so this table — not a module-level map — is what makes one
 * instance's 418 stop all the others. The server-side sync path (OKX & co.)
 * runs on shared egress IPs (hkg1/sin1), where a ban genuinely is global to
 * the app.
 */
import { getSql } from "@/lib/db"

/** When the cooldown for `exchange` ends, or null when it may be called. */
export async function getServerCooldown(exchange: string): Promise<Date | null> {
  const sql = getSql()
  const rows = (await sql`
    SELECT blocked_until
    FROM public.exchange_cooldowns
    WHERE exchange = ${exchange}
      AND blocked_until > NOW()
  `) as { blocked_until: Date }[]
  return rows.length > 0 ? rows[0].blocked_until : null
}

/**
 * Records/extends a cooldown. Monotonic: a later, shorter cooldown (e.g. a 429
 * window) must not shorten a still-active ban.
 */
export async function setServerCooldown(
  exchange: string,
  until: Date,
  reason: string
): Promise<void> {
  const sql = getSql()
  await sql`
    INSERT INTO public.exchange_cooldowns (exchange, blocked_until, reason, updated_at)
    VALUES (${exchange}, ${until}, ${reason}, NOW())
    ON CONFLICT (exchange) DO UPDATE SET
      blocked_until = GREATEST(public.exchange_cooldowns.blocked_until, EXCLUDED.blocked_until),
      reason       = EXCLUDED.reason,
      updated_at   = NOW()
    WHERE EXCLUDED.blocked_until > public.exchange_cooldowns.blocked_until
       OR public.exchange_cooldowns.blocked_until <= NOW()
  `
}
