import test from "node:test"
import assert from "node:assert/strict"
import {
  derivedField,
  formatDerived,
  parseAmount,
  solveAmounts,
  touchField,
  type AmountField,
} from "@/lib/services/spotAmounts"

/** Replays a sequence of edits the way the form does. */
function typed(...fields: AmountField[]): AmountField[] {
  return fields.reduce<AmountField[]>((order, f) => touchField(order, f), [])
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b))

test("nothing is derived until two fields have been typed", () => {
  assert.equal(derivedField([]), null)
  assert.equal(derivedField(typed("usd")), null)
  assert.equal(solveAmounts({ qty: "", usd: "500", price: "" }, typed("usd")), null)
})

test("coins + $ spent derive the price", () => {
  const order = typed("qty", "usd")
  assert.equal(derivedField(order), "price")
  const v = solveAmounts({ qty: "250", usd: "500", price: "" }, order)
  assert.ok(v)
  assert.equal(v.qty, 250)
  assert.equal(v.price, 2)
})

test("$ spent + price derive the coins (the old USD mode)", () => {
  const order = typed("usd", "price")
  assert.equal(derivedField(order), "qty")
  const v = solveAmounts({ qty: "", usd: "500", price: "100000" }, order)
  assert.ok(v)
  assert.ok(close(v.qty, 0.005))
  assert.equal(v.price, 100000)
})

test("coins + price derive the $ spent (the old coins mode)", () => {
  const order = typed("qty", "price")
  assert.equal(derivedField(order), "usd")
  const v = solveAmounts({ qty: "3", usd: "", price: "200" }, order)
  assert.ok(v)
  assert.equal(v.qty, 3)
  assert.equal(v.usd, 600)
})

test("typing into the derived field promotes it and demotes the oldest", () => {
  // coins, then $, so price is derived; now the user overrides the price.
  const order = typed("qty", "usd", "price")
  assert.deepEqual(order, ["price", "usd"])
  assert.equal(derivedField(order), "qty")
})

test("re-typing a field already in the pair keeps the same derived field", () => {
  assert.equal(derivedField(typed("qty", "usd", "qty")), "price")
})

test("a stale value in the derived field is ignored", () => {
  // qty holds an old typed value, but it is the derived one now.
  const v = solveAmounts({ qty: "999", usd: "500", price: "100" }, typed("usd", "price"))
  assert.ok(v)
  assert.equal(v.qty, 5)
})

test("a cleared or invalid typed field yields no solution", () => {
  const order = typed("qty", "usd")
  assert.equal(solveAmounts({ qty: "", usd: "500", price: "" }, order), null)
  assert.equal(solveAmounts({ qty: "abc", usd: "500", price: "" }, order), null)
  assert.equal(solveAmounts({ qty: "0", usd: "500", price: "" }, order), null)
  assert.equal(solveAmounts({ qty: "-1", usd: "500", price: "" }, order), null)
})

test("parseAmount rejects blank, zero, negative and non-numeric input", () => {
  assert.ok(Number.isNaN(parseAmount("")))
  assert.ok(Number.isNaN(parseAmount("   ")))
  assert.ok(Number.isNaN(parseAmount("0")))
  assert.ok(Number.isNaN(parseAmount("-5")))
  assert.ok(Number.isNaN(parseAmount("1,5")))
  assert.ok(Number.isNaN(parseAmount("Infinity")))
  assert.equal(parseAmount(" 0.25 "), 0.25)
})

test("formatDerived never uses exponent notation for small-cap prices", () => {
  const s = formatDerived(0.000003, "price")
  assert.doesNotMatch(s, /e/i)
  assert.equal(Number(s), 0.000003)
})

test("formatDerived trims trailing zeros and rounds $ to cents", () => {
  assert.equal(formatDerived(2, "price"), "2")
  assert.equal(formatDerived(95000.123456, "price"), "95000.12")
  assert.equal(formatDerived(499.99999999, "usd"), "500")
  assert.equal(formatDerived(1234.5, "usd"), "1234.5")
  assert.equal(formatDerived(0.00526315789, "qty"), "0.00526316")
})
