import { cookies } from "next/headers"
import { getSql } from "@/lib/db"
import { SESSION_COOKIE, createSession, sessionCookieOptions } from "@/lib/auth/session"
import { serverError } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Local sign-in without Telegram, for development and the test suites.
 *
 * Hard-gated on NODE_ENV so it 404s in production even if deployed — the gate is
 * the first statement, before anything reads the query string.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new Response("Not found", { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const telegramId = searchParams.get("telegramId") ?? process.env.DEV_TELEGRAM_ID
  const name = searchParams.get("name") ?? "dev"

  if (!telegramId || !/^\d{1,19}$/.test(telegramId)) {
    return Response.json({ error: "telegramId required" }, { status: 400 })
  }

  try {
    const sql = getSql()
    const rows = await sql`
      INSERT INTO public.users (telegram_id, telegram_name)
      VALUES (${BigInt(telegramId)}, ${name})
      ON CONFLICT (telegram_id) DO UPDATE SET telegram_name = public.users.telegram_name
      RETURNING id
    ` as { id: string }[]

    const raw = await createSession(rows[0].id, {
      userAgent: request.headers.get("user-agent"),
      ip: null,
    })
    const store = await cookies()
    store.set(SESSION_COOKIE, raw, sessionCookieOptions)

    // 303 so the browser follows with a GET and lands on the app shell.
    return new Response(null, { status: 303, headers: { Location: "/" } })
  } catch (err) {
    return serverError("auth/dev-login", err)
  }
}
