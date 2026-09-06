import { getNotes, saveNote, isNotePhase, MAX_NOTE_LENGTH } from "@/lib/db/tradeNotes"
import { requireUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

/**
 * Per-trade journal notes.
 *
 * The owner comes from the session; queries stay scoped by telegram_id so
 * ownership is enforced in SQL rather than assumed.
 *
 * GET                                          → { notes: { "EXCH|id": { before?, during?, after? } } }
 * POST { exchange, id, phase, body }           → { ok: true, body: string | null }
 *   A blank body clears the note and comes back as body: null.
 */
export async function GET() {
  const user = await requireUser()
  if (user instanceof Response) return user

  try {
    return Response.json({ notes: await getNotes(user.telegramId) })
  } catch (err) {
    console.error("[trades/notes] GET error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const user = await requireUser()
  if (user instanceof Response) return user

  try {
    const body = (await request.json()) as {
      exchange?: string
      id?: string
      phase?: string
      body?: string
    }

    const { exchange, id, phase } = body

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

    const saved = await saveNote(user.telegramId, exchange, id, phase, text)
    return Response.json({ ok: true, body: saved })
  } catch (err) {
    console.error("[trades/notes] POST error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
