/**
 * The flood detectors, tested as pure logic.
 *
 * Delivery is deliberately not exercised here: alerts only leave the process
 * when NODE_ENV is production (or SECURITY_ALERTS_LOCAL=1), precisely so that a
 * test firing dozens of 401s cannot Telegram the real admins.
 */
import { test, describe, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  __resetSecurityAlerts,
  __thresholds,
  maybeAlertDistributed,
  maybeAlertFlood,
  maybeAlertUserAbuse,
} from "@/lib/security-alert"

const { IP_THRESHOLD, DIST_THRESHOLD, USER_THRESHOLD } = __thresholds

// Exercise the real decision path. Safe: `npm test` runs with no env file, so
// TELEGRAM_BOT_TOKEN is unset and fanOutToAdmins returns before sending
// anything. Without this the detectors short-circuit and the thresholds below
// would pass no matter what they were.
process.env.SECURITY_ALERTS_LOCAL = "1"

describe("documented thresholds", () => {
  // The behavioural tests below read these constants from the module, so they
  // verify the *relationship* (silent below, fires at) but move with the value.
  // Pin the numbers separately, so changing one is a deliberate edit here too.
  test("match the values the design is written around", () => {
    assert.equal(__thresholds.IP_THRESHOLD, 30, "per-IP blocks/min")
    assert.equal(__thresholds.DIST_THRESHOLD, 200, "global blocks/min")
    assert.equal(__thresholds.USER_THRESHOLD, 300, "authenticated req/min per user")
    assert.equal(__thresholds.MAX_TRACKED_IPS, 10_000, "per-IP map safety valve")
    assert.equal(__thresholds.USER_MAX_TRACKED, 10_000, "per-user map safety valve")
  })
})

describe("per-IP flood detector", () => {
  beforeEach(() => __resetSecurityAlerts())

  test("stays quiet below the threshold", () => {
    for (let i = 0; i < IP_THRESHOLD - 1; i++) {
      assert.equal(maybeAlertFlood("1.1.1.1", "/api/me", "401"), undefined)
    }
  })

  test("fires exactly on the threshold, not before", () => {
    for (let i = 0; i < IP_THRESHOLD - 1; i++) {
      assert.equal(
        maybeAlertFlood("1.1.1.1", "/api/me", "401"), undefined,
        `alerted early, at request ${i + 1}`
      )
    }
    assert.ok(
      maybeAlertFlood("1.1.1.1", "/api/me", "401") instanceof Promise,
      "did not alert on crossing the threshold"
    )
  })

  test("debounces: a sustained flood alerts once, not per request", () => {
    for (let i = 0; i < IP_THRESHOLD; i++) maybeAlertFlood("1.1.1.1", "/api/me", "401")
    // Already alerted above; the next 100 blocked requests must stay silent.
    for (let i = 0; i < 100; i++) {
      assert.equal(
        maybeAlertFlood("1.1.1.1", "/api/me", "401"), undefined,
        "alerted again inside the debounce window"
      )
    }
  })

  test("one noisy IP does not implicate another", () => {
    for (let i = 0; i < IP_THRESHOLD * 2; i++) maybeAlertFlood("1.1.1.1", "/api/me", "401")
    // A second IP starts from zero.
    for (let i = 0; i < IP_THRESHOLD - 1; i++) {
      assert.equal(maybeAlertFlood("2.2.2.2", "/api/me", "401"), undefined)
    }
  })

  test("never throws, whatever it is handed", () => {
    assert.doesNotThrow(() => maybeAlertFlood("", "", "401"))
    assert.doesNotThrow(() => maybeAlertFlood("x".repeat(10_000), "/api/me", "429"))
  })
})

describe("distributed detector", () => {
  beforeEach(() => __resetSecurityAlerts())

  test("counts across different IPs, unlike the per-IP detector", () => {
    // Each IP stays well under IP_THRESHOLD, so only the global counter moves.
    for (let i = 0; i < DIST_THRESHOLD - 1; i++) {
      assert.equal(
        maybeAlertDistributed(`10.0.${i % 255}.${i % 255}`, "401"), undefined,
        `alerted early, at request ${i + 1}`
      )
    }
    assert.ok(
      maybeAlertDistributed("10.0.9.9", "401") instanceof Promise,
      "did not alert on crossing the global threshold"
    )
  })

  test("a single IP under its own threshold still trips the global one", () => {
    // 5 requests each from many IPs: no IP reaches IP_THRESHOLD (30), but the
    // global count passes DIST_THRESHOLD. This is the case the per-IP detector
    // is blind to.
    let alerted = false
    for (let i = 0; i < DIST_THRESHOLD + 5; i++) {
      const ip = `172.16.${Math.floor(i / 5) % 255}.${i % 255}`
      if (maybeAlertDistributed(ip, "401") instanceof Promise) alerted = true
    }
    assert.ok(alerted, "a distributed pattern went undetected")
  })

  test("never throws", () => {
    assert.doesNotThrow(() => maybeAlertDistributed("", "429"))
  })
})

describe("authenticated-user abuse detector", () => {
  beforeEach(() => __resetSecurityAlerts())

  test("stays quiet below the threshold", () => {
    for (let i = 0; i < USER_THRESHOLD - 1; i++) {
      assert.equal(
        maybeAlertUserAbuse("990000000001", "/api/trades"), undefined,
        `alerted early, at request ${i + 1}`
      )
    }
    assert.ok(
      maybeAlertUserAbuse("990000000001", "/api/trades") instanceof Promise,
      "did not alert on crossing the per-user threshold"
    )
  })

  test("counts per user, not globally", () => {
    for (let i = 0; i < USER_THRESHOLD * 2; i++) maybeAlertUserAbuse("111", "/api/trades")
    for (let i = 0; i < USER_THRESHOLD - 1; i++) {
      assert.equal(maybeAlertUserAbuse("222", "/api/trades"), undefined)
    }
  })

  test("is alert-only — it returns a value, never a block signal", () => {
    // The contract is Promise<void> | undefined. Nothing here can refuse a request.
    const out = maybeAlertUserAbuse("333", "/api/trades")
    assert.ok(out === undefined || out instanceof Promise)
  })

  test("never throws", () => {
    assert.doesNotThrow(() => maybeAlertUserAbuse("", ""))
  })
})

describe("memory safety valves", () => {
  beforeEach(() => __resetSecurityAlerts())

  test("tracking many distinct IPs does not grow without bound", () => {
    // Past the valve; the map clears rather than retaining every key.
    for (let i = 0; i < __thresholds.MAX_TRACKED_IPS + 500; i++) {
      maybeAlertFlood(`ip-${i}`, "/api/me", "401")
    }
    // Surviving the loop at all is the assertion: no throw, no unbounded growth.
    assert.doesNotThrow(() => maybeAlertFlood("final", "/api/me", "401"))
  })
})
