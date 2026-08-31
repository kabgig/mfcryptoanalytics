import test from "node:test"
import assert from "node:assert/strict"
import {
  CHOICES,
  CHOICE_FIELDS,
  choiceLabel,
  computeRr,
  EMOTIONS,
  EXIT_REASONS,
  isChoice,
  KILLZONES,
  MISTAKES,
  STRATEGIES,
  TIMEFRAMES,
} from "@/lib/services/journalFields"
import { mergeOverride, resolveTrade } from "@/lib/services/overridesService"
import { buildTradesCsv, EXPORT_COLUMNS } from "@/lib/services/exportService"
import type { Trade } from "@/types"

function trade(over: Partial<Trade> & { id: string; exchange: string }): Trade {
  return {
    ticker: "BTCUSDT",
    positionSize: 1,
    tp: null,
    sl: null,
    openTime: "2026-08-01T00:00:00.000Z",
    closeTime: "2026-08-02T00:00:00.000Z",
    pnl: 10,
    ...over,
  }
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]
    if (quoted) {
      if (c === '"') {
        if (csv[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ",") { row.push(field); field = "" }
    else if (c === "\r") { /* consumed with the \n */ }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = [] }
    else field += c
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

// ------------------------------------------------------------- vocabularies

test("the choice vocabularies hold exactly the agreed options", () => {
  assert.deepEqual(STRATEGIES, ["orderflow", "pa", "macro"])
  assert.deepEqual(TIMEFRAMES, ["5m", "15m", "1h"])
  assert.deepEqual(KILLZONES, ["asia", "london", "nyam", "nypm", "outside"])
  assert.deepEqual(EXIT_REASONS, ["tp1", "tp2", "sl", "be", "manual"])
  assert.equal(MISTAKES.length, 16)
  assert.equal(MISTAKES[0], "none", "a clean trade needs its own tag")
})

test("the 'should not have been trading' mistakes group together", () => {
  // Neither is about the trade itself — both say the user was in no state to be
  // taking one, so they sit next to each other rather than among the entry tags.
  assert.ok(isChoice("mistake", "over_2_losses_today"))
  assert.ok(isChoice("mistake", "decided_while_tired"))
  assert.equal(choiceLabel("decided_while_tired"), "Took a decision while tired")
  assert.equal(
    MISTAKES.indexOf("decided_while_tired"),
    MISTAKES.indexOf("over_2_losses_today") + 1
  )
})

test("the two 'did not wait' mistakes read in the order they happen", () => {
  // Rushing in before the setup even forms comes first; failing to wait for
  // displacement to confirm it comes second. Separate errors, sequenced.
  assert.ok(isChoice("mistake", "rushed_no_setup"))
  assert.ok(isChoice("mistake", "no_displacement"))
  assert.equal(choiceLabel("rushed_no_setup"), "Rushed, did not wait for the setup")
  assert.equal(
    MISTAKES.indexOf("no_displacement"),
    MISTAKES.indexOf("rushed_no_setup") + 1
  )
})

test("the entry-context mistakes sit together and are taggable", () => {
  // Both describe something wrong about *where* the entry was taken, so they
  // read as a group in the dropdown rather than being scattered through it.
  assert.ok(isChoice("mistake", "entry_outside_killzone"))
  assert.ok(isChoice("mistake", "entered_against_liquidity"))
  assert.equal(
    choiceLabel("entered_against_liquidity"),
    "Entered against thick liquidity on the other side"
  )
  assert.equal(
    MISTAKES.indexOf("entered_against_liquidity"),
    MISTAKES.indexOf("entry_outside_killzone") + 1
  )
})

test("both break-even failures are taggable and read as a pair", () => {
  // Never moving the stop to break-even and moving it back off break-even are
  // different errors, so one tag cannot stand in for the other.
  assert.ok(isChoice("mistake", "no_move_to_be"))
  assert.ok(isChoice("mistake", "moved_sl_away_from_be"))
  assert.equal(choiceLabel("no_move_to_be"), "Did not move to break-even")
  assert.equal(choiceLabel("moved_sl_away_from_be"), "Moved SL away from break-even")
  // They sit next to each other so the dropdown reads as one pair.
  assert.equal(
    MISTAKES.indexOf("moved_sl_away_from_be"),
    MISTAKES.indexOf("no_move_to_be") + 1
  )
})

test("the emotion list carries greed alongside thrill", () => {
  assert.deepEqual(EMOTIONS, [
    "calm", "confident", "unsure", "fear", "boredom", "thrill", "greed", "anger",
  ])
})

test("isChoice only accepts a field's own options", () => {
  assert.deepEqual(CHOICE_FIELDS.sort(), [
    "emotion", "exitReason", "killzone", "mistake", "strategy", "timeframe",
  ])
  assert.ok(isChoice("emotion", "greed"))
  assert.ok(isChoice("strategy", "orderflow"))
  // A value that is valid for another field is still wrong for this one.
  assert.equal(isChoice("strategy", "greed"), false)
  assert.equal(isChoice("emotion", "orderflow"), false)
  for (const bad of ["", null, undefined, 1, "GREED"]) {
    assert.equal(isChoice("emotion", bad), false, `${String(bad)} should be rejected`)
  }
})

test("every option renders a label rather than a raw slug", () => {
  for (const field of CHOICE_FIELDS) {
    for (const option of CHOICES[field]) {
      const label = choiceLabel(option)
      assert.ok(label.length > 0, `${option} has no label`)
      assert.equal(label.includes("_"), false, `${option} label leaks an underscore`)
    }
  }
  assert.equal(choiceLabel("no_move_to_be"), "Did not move to break-even")
  assert.equal(choiceLabel("calm"), "Calm")
})

// ----------------------------------------------------------------------- R:R

test("R:R is reward over risk from the planned levels", () => {
  // long: entry 100, tp1 120, sl 90 → 20 / 10
  assert.equal(computeRr(100, 120, 90), 2)
  // short: entry 100, tp1 80, sl 105 → 20 / 5. Direction must not matter.
  assert.equal(computeRr(100, 80, 105), 4)
})

test("R:R rounds to two decimals rather than leaking float noise", () => {
  // 1.8 exactly is the threshold the rr_below_1_8 tag talks about.
  assert.equal(computeRr(100, 118, 90), 1.8)
  assert.equal(computeRr(3, 4, 2.7), 3.33)
})

test("R:R is null when a level is missing or the stop sits on the entry", () => {
  assert.equal(computeRr(null, 120, 90), null)
  assert.equal(computeRr(100, null, 90), null)
  assert.equal(computeRr(100, 120, null), null)
  assert.equal(computeRr(undefined, undefined, undefined), null)
  // No distance to the stop means no risk to divide by.
  assert.equal(computeRr(100, 120, 100), null)
})

test("a trade's R:R is computed from its levels when the user set none", () => {
  const resolved = resolveTrade(trade({ id: "1", exchange: "OKX" }), {
    entry: 100, tp1: 120, sl: 90,
  })
  assert.equal(resolved.rr, 2)
  assert.equal(resolved.overridden.rr, false, "a computed R:R is not an override")
})

test("a hand-typed R:R wins over the computed one", () => {
  const resolved = resolveTrade(trade({ id: "1", exchange: "OKX" }), {
    entry: 100, tp1: 120, sl: 90, rr: 1.5,
  })
  assert.equal(resolved.rr, 1.5)
  assert.equal(resolved.overridden.rr, true)
})

test("clearing a hand-typed R:R hands the field back to the arithmetic", () => {
  const merged = mergeOverride({ entry: 100, tp1: 120, sl: 90, rr: 1.5 }, { rr: null })
  assert.equal(merged?.rr, undefined)
  assert.equal(resolveTrade(trade({ id: "1", exchange: "OKX" }), merged!).rr, 2)
})

// --------------------------------------------------------------- patch merge

test("a journal patch stores every field it carries", () => {
  const merged = mergeOverride({}, {
    strategy: "orderflow",
    timeframe: "15m",
    killzone: "london",
    entry: 100,
    tp1: 120,
    tp2: 140,
    sl: 90,
    riskPct: 1,
    rulesOK: true,
    exitReason: "tp1",
    mistake: "none",
    emotion: "greed",
  })
  assert.deepEqual(merged, {
    strategy: "orderflow", timeframe: "15m", killzone: "london",
    entry: 100, tp1: 120, tp2: 140, sl: 90, riskPct: 1,
    rulesOK: true, exitReason: "tp1", mistake: "none", emotion: "greed",
  })
})

test("mistake 'none' is a stored value, not an empty one", () => {
  // "reviewed, nothing wrong" must stay distinguishable from "not reviewed".
  const merged = mergeOverride({}, { mistake: "none" })
  assert.deepEqual(merged, { mistake: "none" })
  assert.equal(mergeOverride({ mistake: "none" }, { mistake: null }), null)
})

test("rulesOK stores false rather than treating it as unset", () => {
  const merged = mergeOverride({}, { rulesOK: false })
  assert.deepEqual(merged, { rulesOK: false })
  assert.equal(resolveTrade(trade({ id: "1", exchange: "OKX" }), merged!).overridden.rulesOK, true)
})

test("a patch touching one field leaves the other thirteen alone", () => {
  const stored = { strategy: "macro", entry: 100, emotion: "calm", bias: "buy" } as const
  const merged = mergeOverride(stored, { emotion: "fear" })
  assert.deepEqual(merged, { strategy: "macro", entry: 100, emotion: "fear", bias: "buy" })
})

test("an invalid choice is dropped rather than stored", () => {
  assert.equal(mergeOverride({}, { emotion: "furious" }), null)
  assert.equal(mergeOverride({}, { strategy: "scalping" }), null)
  assert.equal(mergeOverride({}, { riskPct: 150 }), null, "riskPct is capped at 100")
})

test("clearing the last journal field returns null, the signal to delete the row", () => {
  assert.equal(mergeOverride({ emotion: "calm" }, { emotion: null }), null)
  assert.equal(mergeOverride({ rulesOK: false }, { rulesOK: null }), null)
  // Bias alone still counts as content — it has its own column in the table.
  assert.deepEqual(mergeOverride({ bias: "buy", emotion: "calm" }, { emotion: null }), { bias: "buy" })
})

// ---------------------------------------------------------------------- csv

test("the csv carries every journal field", () => {
  for (const column of [
    "strategy", "timeframe", "killzone", "entry", "tp1", "tp2", "sl",
    "riskPct", "rr", "rulesOK", "exitReason", "mistake", "emotion",
  ]) {
    assert.ok(EXPORT_COLUMNS.includes(column as never), `${column} missing from the export`)
  }
})

test("the csv exports a journal entry, including the computed R:R", () => {
  const [header, csvRow] = parseCsv(
    buildTradesCsv([trade({ id: "1", exchange: "OKX" })], {}, {
      "OKX|1": {
        strategy: "pa", timeframe: "1h", killzone: "nyam",
        entry: 100, tp1: 120, tp2: 140, sl: 90, riskPct: 1.5,
        rulesOK: false, exitReason: "be", mistake: "chased_price", emotion: "greed",
      },
    })
  )
  const col = (name: string) => csvRow[header.indexOf(name)]
  assert.equal(col("strategy"), "pa")
  assert.equal(col("timeframe"), "1h")
  assert.equal(col("killzone"), "nyam")
  assert.equal(col("entry"), "100")
  assert.equal(col("tp1"), "120")
  assert.equal(col("tp2"), "140")
  assert.equal(col("sl"), "90")
  assert.equal(col("riskPct"), "1.5")
  assert.equal(col("rr"), "2", "the computed R:R should be exported")
  assert.equal(col("rulesOK"), "no")
  assert.equal(col("exitReason"), "be")
  assert.equal(col("mistake"), "chased_price")
  assert.equal(col("emotion"), "greed")
})

test("rulesOK exports blank when unset, not 'no'", () => {
  const [header, csvRow] = parseCsv(buildTradesCsv([trade({ id: "1", exchange: "OKX" })]))
  assert.equal(csvRow[header.indexOf("rulesOK")], "")
})
