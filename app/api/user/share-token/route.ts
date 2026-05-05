import { getSql } from "@/lib/db"
import { randomBytes } from "crypto"

export const dynamic = "force-dynamic"

// POST — generate a new share token for the user
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const telegramId = searchParams.get("telegramId")

  if (!telegramId || isNaN(Number(telegramId))) {
    return Response.json({ error: "Missing or invalid telegramId" }, { status: 400 })
  }

  const token = randomBytes(24).toString("hex")

  try {
    const sql = getSql()
    await sql`
      UPDATE users
      SET share_token = ${token}
      WHERE telegram_id = ${BigInt(telegramId)}
    `
    return Response.json({ token })
  } catch (err) {
    console.error("[share-token] POST error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}

// GET — fetch the current share token for the user
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const telegramId = searchParams.get("telegramId")

  if (!telegramId || isNaN(Number(telegramId))) {
    return Response.json({ error: "Missing or invalid telegramId" }, { status: 400 })
  }

  try {
    const sql = getSql()
    const rows = await sql`
      SELECT share_token FROM users WHERE telegram_id = ${BigInt(telegramId)} LIMIT 1
    ` as { share_token: string | null }[]

    if (rows.length === 0) {
      return Response.json({ token: null })
    }

    return Response.json({ token: rows[0].share_token ?? null })
  } catch (err) {
    console.error("[share-token] GET error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}

// DELETE — revoke the share token
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const telegramId = searchParams.get("telegramId")

  if (!telegramId || isNaN(Number(telegramId))) {
    return Response.json({ error: "Missing or invalid telegramId" }, { status: 400 })
  }

  try {
    const sql = getSql()
    await sql`
      UPDATE users
      SET share_token = NULL
      WHERE telegram_id = ${BigInt(telegramId)}
    `
    return Response.json({ ok: true })
  } catch (err) {
    console.error("[share-token] DELETE error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
