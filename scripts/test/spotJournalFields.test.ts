import test from "node:test"
import assert from "node:assert/strict"
import {
  EMPTY_SPOT_JOURNAL,
  MAX_SPOT_NOTE_LENGTH,
  SPOT_FEELINGS,
  SPOT_TAG_DELIMITER,
  SPOT_WHY,
  hasSpotJournal,
  journalFromRow,
  parseSpotJournalBody,
  parseSpotTags,
  serializeSpotTags,
  spotTagLabel,
} from "@/lib/services/spotJournalFields"

const valid = { planned: true, why: ["dip", "dca"], feeling: ["fomo"], note: "  bought the dip\nagain  " }

test("vocabularies are the requested options, and no tag contains the delimiter", () => {
  assert.deepEqual([...SPOT_WHY], ["dca", "dip", "news", "pump", "take_profit"])
  assert.deepEqual([...SPOT_FEELINGS], ["calm", "unsure", "thrill", "fomo"])
  for (const tag of [...SPOT_WHY, ...SPOT_FEELINGS]) {
    assert.ok(!tag.includes(SPOT_TAG_DELIMITER), tag)
    assert.ok(!tag.includes(","), `${tag} would need CSV quoting`)
  }
  assert.equal(spotTagLabel("take_profit"), "Take profit")
  assert.equal(spotTagLabel("dca"), "DCA")
  assert.equal(spotTagLabel("fomo"), "FOMO")
  assert.equal(spotTagLabel("dip"), "Dip")
})

test("a valid body parses: tags in vocabulary order, note trimmed but line breaks kept", () => {
  assert.deepEqual(parseSpotJournalBody(valid), {
    planned: true,
    why: ["dca", "dip"],
    feeling: ["fomo"],
    note: "bought the dip\nagain",
  })
})

test("clearing everything is valid and yields the empty journal", () => {
  assert.deepEqual(
    parseSpotJournalBody({ planned: null, why: [], feeling: [], note: "   " }),
    EMPTY_SPOT_JOURNAL
  )
})

test("every tag at once is accepted", () => {
  const r = parseSpotJournalBody({ planned: false, why: [...SPOT_WHY], feeling: [...SPOT_FEELINGS], note: "" })
  assert.notEqual(typeof r, "string")
})

test("a note of exactly the cap is accepted; one character more is not", () => {
  const ok = parseSpotJournalBody({ ...valid, note: "x".repeat(MAX_SPOT_NOTE_LENGTH) })
  assert.notEqual(typeof ok, "string")
  const tooLong = parseSpotJournalBody({ ...valid, note: "x".repeat(MAX_SPOT_NOTE_LENGTH + 1) })
  assert.match(String(tooLong), /at most 4000/)
})

for (const [label, patch] of [
  ["planned as a string", { planned: "yes" }],
  ["planned as a number", { planned: 1 }],
  ["planned missing", { planned: undefined }],
  ["why missing", { why: undefined }],
  ["why as a string", { why: "dca" }],
  ["why with an unknown tag", { why: ["moon"] }],
  ["why with a feeling tag", { why: ["calm"] }],
  ["why repeating a tag", { why: ["dca", "dca"] }],
  ["why with a non-string", { why: [1] }],
  ["feeling missing", { feeling: undefined }],
  ["feeling with an unknown tag", { feeling: ["greed"] }],
  ["feeling with too many entries", { feeling: ["calm", "unsure", "thrill", "fomo", "calm"] }],
  ["note missing", { note: undefined }],
  ["note as a number", { note: 5 }],
  ["note as null", { note: null }],
] as [string, Record<string, unknown>][]) {
  test(`rejects ${label}`, () => {
    const body: Record<string, unknown> = { ...valid, ...patch }
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete body[k]
    assert.equal(typeof parseSpotJournalBody(body), "string")
  })
}

test("stored columns round-trip, and unknown tags from the database are dropped", () => {
  assert.equal(serializeSpotTags([]), null)
  assert.equal(serializeSpotTags(["dca", "dip"]), "dca|dip")
  assert.deepEqual(parseSpotTags("why", "dip|dca|moon"), ["dca", "dip"])
  assert.deepEqual(parseSpotTags("why", null), [])
  assert.deepEqual(parseSpotTags("why", ""), [])
})

test("a legacy row with every journal column NULL reads as the empty journal", () => {
  assert.deepEqual(journalFromRow({ planned: null, why: null, feeling: null, note: null }), EMPTY_SPOT_JOURNAL)
  assert.deepEqual(journalFromRow({}), EMPTY_SPOT_JOURNAL)
  assert.deepEqual(
    journalFromRow({ planned: false, why: "take_profit", feeling: "calm|unsure", note: "n" }),
    { planned: false, why: ["take_profit"], feeling: ["calm", "unsure"], note: "n" }
  )
})

test("hasSpotJournal: any one field lights the icon; planned=false counts", () => {
  assert.equal(hasSpotJournal(undefined), false)
  assert.equal(hasSpotJournal(EMPTY_SPOT_JOURNAL), false)
  assert.equal(hasSpotJournal({ ...EMPTY_SPOT_JOURNAL, note: "   " }), false)
  assert.equal(hasSpotJournal({ ...EMPTY_SPOT_JOURNAL, planned: false }), true)
  assert.equal(hasSpotJournal({ ...EMPTY_SPOT_JOURNAL, why: ["dca"] }), true)
  assert.equal(hasSpotJournal({ ...EMPTY_SPOT_JOURNAL, feeling: ["calm"] }), true)
  assert.equal(hasSpotJournal({ ...EMPTY_SPOT_JOURNAL, note: "x" }), true)
})
