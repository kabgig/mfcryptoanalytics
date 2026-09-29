import { getOverrides, saveOverride } from "@/lib/db/tradeOverrides"
import {
  isBias,
  isStorableNumber,
  MAX_NOTES_LENGTH,
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
import { requireUser } from "@/lib/auth/session"
import { enforceBodyLimit } from "@/lib/api/body-limit"
import { serverError } from "@/lib/api/errors"

/**
 * Twice the default cap, because `notes` is free text: 16k UTF-16 units can be
 * ~48 KB of UTF-8 in the worst case, before the rest of the journal is added.
 */
const BODY_LIMIT = 64 * 1024

export const dynamic = "force-dynamic"

/**
 * Manual TP / SL / Bias for a trade.
 *
 * The owner comes from the session; queries stay scoped by telegram_id so
 * ownership is enforced in SQL rather than assumed.
 *
 * GET                   → { overrides: { "EXCH|id": { tp1?, sl?, bias?, … } } }
 * POST { exchange, id, …any journal field }
 *                       → { ok: true, override: {…} | null }
 *   Patch semantics: a field left out is untouched, a field sent as null is
 *   cleared (the exchange value, or the computed R:R, takes over again).
 *   Clearing the last one deletes the row and comes back as override: null.
 *   signals, exitReason, mistake and emotion take an array; a bare string still
 *   means the one-tag list it used to, and [] clears the field like null does.
 *   notes is a string of at most MAX_NOTES_LENGTH; blank clears it.
 */
export async function GET() {
  const user = await requireUser()
  if (user instanceof Response) return user

  try {
    return Response.json({ overrides: await getOverrides(user.telegramId) })
  } catch (err) {
    return serverError("trades/overrides GET", err)
  }
}

export async function POST(request: Request) {
  const user = await requireUser()
  if (user instanceof Response) return user

  const tooLarge = enforceBodyLimit(request, BODY_LIMIT)
  if (tooLarge) return tooLarge

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return Response.json({ error: "Body must be a JSON object" }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {
    const { exchange, id } = body

    if (typeof exchange !== "string" || typeof id !== "string" || !exchange || !id) {
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

    if ("notes" in raw) {
      const value = raw.notes
      if (value === null || value === "") patch.notes = null
      else if (typeof value !== "string") {
        return Response.json({ error: "notes must be a string or null" }, { status: 400 })
      } else if (value.length > MAX_NOTES_LENGTH) {
        return Response.json(
          { error: `notes must be at most ${MAX_NOTES_LENGTH} characters` },
          { status: 400 }
        )
      } else patch.notes = value
    }

    if (Object.keys(patch).length === 0) {
      return Response.json({ error: "Nothing to update" }, { status: 400 })
    }

    const override = await saveOverride(user.telegramId, exchange, id, patch)
    return Response.json({ ok: true, override })
  } catch (err) {
    return serverError("trades/overrides POST", err)
  }
}
