import { getOverrides, saveOverride } from "@/lib/db/tradeOverrides"
import {
  isBias,
  isStorableNumber,
  NUMBER_FIELDS,
  NUMBER_LIMITS,
  type OverridePatch,
} from "@/lib/services/overridesService"
import {
  CHOICES,
  isChoice,
  isChoiceList,
  MULTI_CHOICE_FIELDS,
  SINGLE_CHOICE_FIELDS,
} from "@/lib/services/journalFields"

export const dynamic = "force-dynamic"

/**
 * Manual TP / SL / Bias for a trade.
 *
 * Like every other route here, telegramId is taken from the client and not
 * verified (see app/api/trades/delete/route.ts) — the scoping below only stops
 * one user reaching another's overrides by trade id alone, it is not
 * authentication.
 *
 * GET  ?telegramId=…    → { overrides: { "EXCH|id": { tp1?, sl?, bias?, … } } }
 * POST { telegramId, exchange, id, …any journal field }
 *                       → { ok: true, override: {…} | null }
 *   Patch semantics: a field left out is untouched, a field sent as null is
 *   cleared (the exchange value, or the computed R:R, takes over again).
 *   Clearing the last one deletes the row and comes back as override: null.
 *   exitReason, mistake and emotion take an array; a bare string still means the
 *   one-tag list it used to, and [] clears the field like null does.
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
      [field: string]: unknown
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
    const raw = body as Record<string, unknown>

    for (const field of NUMBER_FIELDS) {
      if (!(field in raw)) continue
      const value = raw[field]
      if (value === null || value === "") {
        patch[field] = null
        continue
      }
      const num = typeof value === "string" ? Number(value) : value
      if (!isStorableNumber(field, num)) {
        const { min, max } = NUMBER_LIMITS[field]
        const range = max === Infinity ? `at least ${min}` : `between ${min} and ${max}`
        return Response.json(
          { error: `${field} must be a number ${range}, or null` },
          { status: 400 }
        )
      }
      patch[field] = num
    }

    for (const field of SINGLE_CHOICE_FIELDS) {
      if (!(field in raw)) continue
      const value = raw[field]
      if (value === null || value === "") {
        patch[field] = null
        continue
      }
      if (!isChoice(field, value)) {
        return Response.json(
          { error: `${field} must be one of: ${CHOICES[field].join(", ")}` },
          { status: 400 }
        )
      }
      patch[field] = value as string
    }

    for (const field of MULTI_CHOICE_FIELDS) {
      if (!(field in raw)) continue
      const value = raw[field]
      // Three ways to say "unset": null, "", and []. All clear the field.
      if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
        patch[field] = null
        continue
      }
      // A bare string is still accepted, so a caller written against the
      // single-valued version of this route keeps working — it means the
      // one-tag list it always did.
      const values = typeof value === "string" ? [value] : value
      if (!isChoiceList(field, values)) {
        return Response.json(
          {
            error:
              `${field} must be a list of: ${CHOICES[field].join(", ")}` +
              " — with no repeats, or null to clear",
          },
          { status: 400 }
        )
      }
      patch[field] = values
    }

    if ("bias" in raw) {
      if (raw.bias === null || raw.bias === "") patch.bias = null
      else if (isBias(raw.bias)) patch.bias = raw.bias
      else return Response.json({ error: "bias must be buy, sell or null" }, { status: 400 })
    }

    if ("rulesOK" in raw) {
      if (raw.rulesOK === null || raw.rulesOK === "") patch.rulesOK = null
      else if (typeof raw.rulesOK === "boolean") patch.rulesOK = raw.rulesOK
      else return Response.json({ error: "rulesOK must be true, false or null" }, { status: 400 })
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
