import { getEntries, insertEntry, softDeleteEntry } from "@/lib/db/spot"
import { heldQty } from "@/lib/services/spotService"
import { requireUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

/**
 * Manual spot entries. The owner comes from the session; every query stays
 * scoped by telegram_id so ownership is enforced in SQL.
 */
export async function GET() {
  const user = await requireUser()
  if (user instanceof Response) return user

  try {
    return Response.json({ entries: await getEntries(user.telegramId) })
  } catch (err) {
    console.error("[spot/entries] GET error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const user = await requireUser()
  if (user instanceof Response) return user

  try {
    const body = (await request.json()) as {
      ticker?: string
      side?: string
      qty?: number | string
      price?: number | string
      tradedAt?: string
    }

    const ticker = String(body.ticker ?? "").trim().toUpperCase()
    if (!ticker || !/^[A-Z0-9.-]{1,20}$/.test(ticker)) {
      return Response.json({ error: "Invalid ticker" }, { status: 400 })
    }

    const side = String(body.side ?? "BUY").toUpperCase()
    if (side !== "BUY" && side !== "SELL") {
      return Response.json({ error: "Side must be BUY or SELL" }, { status: 400 })
    }

    const qty = Number(body.qty)
    if (!Number.isFinite(qty) || qty <= 0) {
      return Response.json({ error: "Quantity must be greater than 0" }, { status: 400 })
    }

    const price = Number(body.price)
    if (!Number.isFinite(price) || price < 0) {
      return Response.json({ error: "Price must be 0 or greater" }, { status: 400 })
    }

    const tradedAt = body.tradedAt ? new Date(body.tradedAt) : null
    if (!tradedAt || isNaN(tradedAt.getTime())) {
      return Response.json({ error: "Invalid date" }, { status: 400 })
    }

    // Selling more than is held would drive the position negative and make the
    // average entry meaningless, so it is rejected before it reaches the table.
    if (side === "SELL") {
      const held = heldQty(await getEntries(user.telegramId), ticker)
      if (qty > held) {
        return Response.json(
          { error: `Cannot sell ${qty} ${ticker} — only ${held} held` },
          { status: 400 }
        )
      }
    }

    const entry = await insertEntry(user.telegramId, {
      ticker,
      side,
      qty,
      price,
      tradedAt: tradedAt.toISOString(),
    })
    return Response.json({ ok: true, entry })
  } catch (err) {
    console.error("[spot/entries] POST error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const user = await requireUser()
  if (user instanceof Response) return user

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id || isNaN(Number(id))) {
    return Response.json({ error: "Missing or invalid id" }, { status: 400 })
  }

  try {
    const deleted = await softDeleteEntry(user.telegramId, id)
    if (!deleted) return Response.json({ error: "Not found" }, { status: 404 })
    return Response.json({ ok: true })
  } catch (err) {
    console.error("[spot/entries] DELETE error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
