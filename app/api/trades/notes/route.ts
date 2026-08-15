import { getNotes, saveNote, isNotePhase, MAX_NOTE_LENGTH } from "@/lib/db/tradeNotes"

export const dynamic = "force-dynamic"

/**
 * Per-trade journal notes.
 *
 * Like every other route here, telegramId is taken from the client and not
 * verified (see app/api/trades/delete/route.ts) — the scoping below only stops
 * one user reaching another's notes by trade id alone, it is not authentication.
 *
 * GET  ?telegramId=…                                  → { notes: { "EXCH|id": { before?, during?, after? } } }
 * POST { telegramId, exchange, id, phase, body }       → { ok: true, body: string | null }
 *   A blank body clears the note and comes back as body: null.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const telegramId = searchParams.get("telegramId")

  if (!telegramId || isNaN(Number(telegramId))) {
    return Response.json({ error: "Missing or invalid telegramId" }, { status: 400 })
  }

  try {
    return Response.json({ notes: await getNotes(telegramId) })
  } catch (err) {
    console.error("[trades/notes] GET error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      telegramId?: string
      exchange?: string
      id?: string
      phase?: string
      body?: string
    }

    const { telegramId, exchange, id, phase } = body

    if (!telegramId || isNaN(Number(telegramId))) {
      return Response.json({ error: "Missing or invalid telegramId" }, { status: 400 })
    }
    if (!exchange || !id) {
      return Response.json({ error: "Missing exchange or id" }, { status: 400 })
    }
    if (!isNotePhase(phase)) {
      return Response.json({ error: "Phase must be before, during or after" }, { status: 400 })
    }

    const text = typeof body.body === "string" ? body.body : ""
    if (text.length > MAX_NOTE_LENGTH) {
      return Response.json(
        { error: `Note is too long (max ${MAX_NOTE_LENGTH} characters)` },
        { status: 400 }
      )
    }

    const saved = await saveNote(String(telegramId), exchange, id, phase, text)
    return Response.json({ ok: true, body: saved })
  } catch (err) {
    console.error("[trades/notes] POST error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
