/**
 * The sliding-window limiter, tested directly.
 *
 * proxy.ts exempts loopback outside production so the suites can sign in freely,
 * which means these unit tests are the only coverage of the limiter's behaviour.
 */
import { test, describe, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { MODERATE, STRICT, __resetRateLimit, rateLimit } from "@/lib/rate-limit"

describe("rate limiter", () => {
  beforeEach(() => __resetRateLimit())

  test("STRICT allows exactly its budget, then refuses", () => {
    for (let i = 0; i < STRICT.limit; i++) {
      assert.equal(rateLimit("a", STRICT).ok, true, `refused early at ${i + 1}`)
    }
    assert.equal(rateLimit("a", STRICT).ok, false, "allowed one over budget")
  })

  test("a refusal carries a Retry-After the caller can use", () => {
    for (let i = 0; i < STRICT.limit + 1; i++) rateLimit("b", STRICT)
    const { ok, retryAfter } = rateLimit("b", STRICT)
    assert.equal(ok, false)
    assert.ok(retryAfter > 0, "no Retry-After on a refusal")
    assert.ok(retryAfter <= STRICT.windowMs / 1000, "Retry-After longer than the window")
  })

  test("buckets are per key — one caller cannot lock out another", () => {
    for (let i = 0; i < STRICT.limit + 5; i++) rateLimit("noisy", STRICT)
    assert.equal(rateLimit("quiet", STRICT).ok, true, "an unrelated key was refused")
  })

  test("MODERATE has a larger budget than STRICT", () => {
    assert.ok(MODERATE.limit > STRICT.limit)
    for (let i = 0; i < STRICT.limit + 1; i++) {
      assert.equal(rateLimit("m", MODERATE).ok, true)
    }
  })

  test("a blocked key stays blocked without re-counting", () => {
    for (let i = 0; i < STRICT.limit + 1; i++) rateLimit("c", STRICT)
    // Repeat refusals must be cheap and consistent, not flap back to allowed.
    for (let i = 0; i < 50; i++) {
      assert.equal(rateLimit("c", STRICT).ok, false, `flapped to allowed at ${i}`)
    }
  })

  test("fails open rather than throwing", () => {
    assert.doesNotThrow(() => rateLimit("", STRICT))
    assert.equal(rateLimit("x".repeat(100_000), STRICT).ok, true)
  })

  test("documented tiers", () => {
    assert.deepEqual(STRICT, { limit: 10, windowMs: 60_000 })
    assert.deepEqual(MODERATE, { limit: 60, windowMs: 60_000 })
  })
})
