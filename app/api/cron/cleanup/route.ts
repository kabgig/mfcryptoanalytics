import { archiveOldTrades, ARCHIVE_AFTER_YEARS } from "@/lib/db/trades"

export const dynamic = "force-dynamic"

/**
 * Daily hygiene job (vercel.json, 03:00). Archives trades that closed more than
 * ARCHIVE_AFTER_YEARS ago; it does not delete anything.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get("authorization")

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const archived = await archiveOldTrades()
  console.log(`[cron/cleanup] archived ${archived} trades older than ${ARCHIVE_AFTER_YEARS} years`)
  return Response.json({ archived, olderThanYears: ARCHIVE_AFTER_YEARS })
}
