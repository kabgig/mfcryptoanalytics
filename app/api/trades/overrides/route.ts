import { getOverrides, saveOverride } from "@/lib/db/tradeOverrides"
import {
  isBias,
  isStorablePrice,
  PRICE_FIELDS,
  type OverridePatch,
} from "@/lib/services/overridesService"

export const dynamic = "force-dynamic"

/**
 * Manual TP / SL / Bias for a trade.
 *
 * Like every other route here, telegramId is taken from the client and not
 * verified (see app/api/trades/delete/route.ts) — the scoping below only stops
 * one user reaching another's overrides by trade id alone, it is not
 * authentication.
 *
 * GET  ?telegramId=…                            → { overrides: { "EXCH|id": { tp?, sl?, bias? } } }
 * POST { telegramId, exchange, id, tp?, sl?, bias? }
 *                                               → { ok: true, override: {…} | null }
 *   Patch semantics: a field left out is untouched, a field sent as null is
 *   cleared (the exchange value takes over again). Clearing the last one
 *   deletes the row and comes back as override: null.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const telegramId = searchParams.get("telegramId")

  if (!telegramId || isNaN(Number(telegramId))) {
    return Response.json({ error: "Missing or invalid telegramId" }, { status: 400 })
  }

  try {
    return Response.json({ overrides: await getOverrides(telegramId) })
  } catch (err) {
    console.error("[trades/overrides] GET error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      telegramId?: string
      exchange?: string
      id?: string
      tp?: unknown
      sl?: unknown
      bias?: unknown
    }

    const { telegramId, exchange, id } = body

    if (!telegramId || isNaN(Number(telegramId))) {
      return Response.json({ error: "Missing or invalid telegramId" }, { status: 400 })
    }
    if (!exchange || !id) {
      return Response.json({ error: "Missing exchange or id" }, { status: 400 })
    }

    // Only keys actually present become part of the patch, so an absent field
    // and a null one mean different things: leave alone vs. clear.
    const patch: OverridePatch = {}

    for (const field of PRICE_FIELDS) {
      if (!(field in body)) continue
      const value = body[field]
      if (value === null || value === "") {
        patch[field] = null
        continue
      }
      const num = typeof value === "string" ? Number(value) : value
      if (!isStorablePrice(num)) {
        return Response.json(
          { error: `${field} must be a non-negative number or null` },
          { status: 400 }
        )
      }
      patch[field] = num
    }

    if ("bias" in body) {
      if (body.bias === null || body.bias === "") patch.bias = null
      else if (isBias(body.bias)) patch.bias = body.bias
      else return Response.json({ error: "bias must be buy, sell or null" }, { status: 400 })
    }

    if (Object.keys(patch).length === 0) {
      return Response.json({ error: "Nothing to update" }, { status: 400 })
    }

    const override = await saveOverride(String(telegramId), exchange, id, patch)
    return Response.json({ ok: true, override })
  } catch (err) {
    console.error("[trades/overrides] POST error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
