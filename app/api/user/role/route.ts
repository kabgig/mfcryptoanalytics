import { getSql } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const telegramId = searchParams.get("telegramId")

  if (!telegramId || isNaN(Number(telegramId))) {
    return Response.json({ error: "Missing or invalid telegramId" }, { status: 400 })
  }

  try {
    const sql = getSql()
    const rows = await sql`
      SELECT role FROM users WHERE telegram_id = ${BigInt(telegramId)} LIMIT 1
    ` as { role: string }[]

    if (rows.length === 0) {
      return Response.json({ role: "USER" })
    }

    return Response.json({ role: rows[0].role })
  } catch (err) {
    console.error("[user/role] DB error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
