import { getEntries, insertEntry, softDeleteEntry, updateEntry } from "@/lib/db/spot"
import { DUST, heldBefore } from "@/lib/services/spotService"
import { requireUser } from "@/lib/auth/session"
import { enforceBodyLimit } from "@/lib/api/body-limit"
import { serverError } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

const ROUTE = "spot/entries"

const badRequest = (error: string) => Response.json({ error }, { status: 400 })

/** The `?id=` of an existing row: a positive integer that fits a BIGINT. */
function parseId(request: Request): string | null {
  const id = new URL(request.url).searchParams.get("id")
  return id && /^[1-9]\d{0,17}$/.test(id) ? id : null
}

/** The JSON body as a plain object, or null when it is not one. */
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Quantity and price, shared by POST and PUT so both apply the same rules. */
function parseAmounts(
  body: Record<string, unknown>
): { qty: number; price: number } | Response {
  const isNum = (v: unknown) => typeof v === "number" || typeof v === "string"
  const qty = isNum(body.qty) ? Number(body.qty) : NaN
  if (!Number.isFinite(qty) || qty <= 0) return badRequest("Quantity must be greater than 0")

  const price = isNum(body.price) ? Number(body.price) : NaN
  if (!Number.isFinite(price) || price < 0) return badRequest("Price must be 0 or greater")

  return { qty, price }
}

/** A quantity without float noise: 0.30000000000000004 reads as 0.3. */
const fmtQty = (v: number) => String(Number(v.toFixed(8)))

const oversellError = (qty: number, ticker: string, held: number, tradedAt: string) =>
  badRequest(
    `Cannot sell ${fmtQty(qty)} ${ticker} — only ${fmtQty(held)} held on ${tradedAt.slice(0, 10)}`
  )

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
    return serverError(ROUTE, err)
  }
}

export async function POST(request: Request) {
  const user = await requireUser()
  if (user instanceof Response) return user

  const tooLarge = enforceBodyLimit(request)
  if (tooLarge) return tooLarge

  const body = await readBody(request)
  if (!body) return badRequest("Invalid JSON body")

  const ticker = String(body.ticker ?? "").trim().toUpperCase()
  if (!ticker || !/^[A-Z0-9.-]{1,20}$/.test(ticker)) return badRequest("Invalid ticker")

  const side = String(body.side ?? "BUY").toUpperCase()
  if (side !== "BUY" && side !== "SELL") return badRequest("Side must be BUY or SELL")

  const amounts = parseAmounts(body)
  if (amounts instanceof Response) return amounts

  const tradedAt =
    typeof body.tradedAt === "string" && body.tradedAt.length <= 40
      ? new Date(body.tradedAt)
      : null
  if (!tradedAt || isNaN(tradedAt.getTime())) return badRequest("Invalid date")

  try {
    // A sell may only take what was held on its own date. Checking against
    // today's holdings let a backdated sell land before the buy that funded it.
    if (side === "SELL") {
      const held = heldBefore(await getEntries(user.telegramId), ticker, tradedAt.toISOString())
      if (amounts.qty - held > DUST) {
        return oversellError(amounts.qty, ticker, held, tradedAt.toISOString())
      }
    }

    const entry = await insertEntry(user.telegramId, {
      ticker,
      side,
      ...amounts,
      tradedAt: tradedAt.toISOString(),
    })
    return Response.json({ ok: true, entry })
  } catch (err) {
    return serverError(ROUTE, err)
  }
}

/**
 * Replaces an entry's quantity and price. Ticker, side and date are not
 * editable: anything else in the body is ignored.
 *
 * Enlarging a SELL past what was held at that point is rejected, like adding
 * one. Shrinking a BUY is allowed even when it strands a later SELL; the table
 * flags that SELL instead (see `oversoldSells`).
 */
export async function PUT(request: Request) {
  const user = await requireUser()
  if (user instanceof Response) return user

  const tooLarge = enforceBodyLimit(request)
  if (tooLarge) return tooLarge

  const id = parseId(request)
  if (!id) return badRequest("Missing or invalid id")

  const body = await readBody(request)
  if (!body) return badRequest("Invalid JSON body")

  const amounts = parseAmounts(body)
  if (amounts instanceof Response) return amounts

  try {
    const entries = await getEntries(user.telegramId)
    const current = entries.find((e) => e.id === id)
    if (!current) return Response.json({ error: "Not found" }, { status: 404 })

    if (current.side === "SELL" && amounts.qty > current.qty) {
      const held = heldBefore(entries, current.ticker, current.tradedAt, current.id)
      if (amounts.qty - held > DUST) {
        return oversellError(amounts.qty, current.ticker, held, current.tradedAt)
      }
    }

    const entry = await updateEntry(user.telegramId, id, amounts)
    if (!entry) return Response.json({ error: "Not found" }, { status: 404 })
    return Response.json({ ok: true, entry })
  } catch (err) {
    return serverError(ROUTE, err)
  }
}

export async function DELETE(request: Request) {
  const user = await requireUser()
  if (user instanceof Response) return user

  const id = parseId(request)
  if (!id) return badRequest("Missing or invalid id")

  try {
    const deleted = await softDeleteEntry(user.telegramId, id)
    if (!deleted) return Response.json({ error: "Not found" }, { status: 404 })
    return Response.json({ ok: true })
  } catch (err) {
    return serverError(ROUTE, err)
  }
}
