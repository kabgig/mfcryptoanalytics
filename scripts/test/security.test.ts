import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_BODY_LIMIT,
  MAX_IDS_PER_REQUEST,
  MAX_TRADES_PER_REQUEST,
  TRADE_BATCH_BODY_LIMIT,
  enforceBodyLimit,
} from "@/lib/api/body-limit"
import { isValidWebhookSecret } from "@/lib/api/webhook-auth"
import { serverError, upstreamError } from "@/lib/api/errors"
import { isLinkPreviewCrawler } from "@/lib/api/crawler"

const req = (contentLength: string | null) =>
  new Request("http://x/api/t", {
    method: "POST",
    headers: contentLength === null ? {} : { "content-length": contentLength },
  })

describe("enforceBodyLimit", () => {
  test("allows a body under the limit", () => {
    assert.equal(enforceBodyLimit(req("100")), null)
  })

  test("allows a body exactly at the limit", () => {
    assert.equal(enforceBodyLimit(req(String(DEFAULT_BODY_LIMIT))), null)
  })

  test("rejects a body over the limit with 413", () => {
    const res = enforceBodyLimit(req(String(DEFAULT_BODY_LIMIT + 1)))
    assert.ok(res, "expected a response")
    assert.equal(res.status, 413)
  })

  test("honours a caller-supplied larger limit", () => {
    const big = String(2 * 1024 * 1024)
    assert.ok(enforceBodyLimit(req(big)), "default limit should reject 2 MB")
    assert.equal(
      enforceBodyLimit(req(big), TRADE_BATCH_BODY_LIMIT),
      null,
      "trade-batch limit should accept 2 MB"
    )
  })

  test("passes through when Content-Length is absent (chunked)", () => {
    // The array-length caps are what actually protect the DB in this case.
    assert.equal(enforceBodyLimit(req(null)), null)
  })

  test("passes a malformed Content-Length to the body parser instead of 413ing", () => {
    assert.equal(enforceBodyLimit(req("not-a-number")), null)
  })

  test("the 413 body keeps the `error` key clients branch on", async () => {
    const res = enforceBodyLimit(req(String(DEFAULT_BODY_LIMIT + 1)))!
    const json = (await res.json()) as { error?: string }
    assert.equal(typeof json.error, "string")
  })

  test("row caps are set above a realistic import", () => {
    assert.ok(MAX_TRADES_PER_REQUEST >= 10_000)
    assert.ok(MAX_IDS_PER_REQUEST >= 10_000)
  })
})

describe("isValidWebhookSecret", () => {
  const SECRET = "a".repeat(64)

  test("accepts the exact secret", () => {
    assert.equal(isValidWebhookSecret(SECRET, SECRET), true)
  })

  test("rejects a wrong secret of the same length", () => {
    assert.equal(isValidWebhookSecret("b".repeat(64), SECRET), false)
  })

  test("rejects a secret differing only in the last byte", () => {
    assert.equal(isValidWebhookSecret("a".repeat(63) + "b", SECRET), false)
  })

  test("rejects a prefix of the secret", () => {
    assert.equal(isValidWebhookSecret("a".repeat(32), SECRET), false)
  })

  test("rejects a longer string containing the secret", () => {
    assert.equal(isValidWebhookSecret(SECRET + "x", SECRET), false)
  })

  test("rejects a missing header", () => {
    assert.equal(isValidWebhookSecret(null, SECRET), false)
  })

  test("rejects an empty header", () => {
    assert.equal(isValidWebhookSecret("", SECRET), false)
  })

  // Fail closed: an unconfigured deployment must reject, not wave through.
  test("rejects everything when the env var is unset", () => {
    assert.equal(isValidWebhookSecret(SECRET, undefined), false)
    assert.equal(isValidWebhookSecret("", undefined), false)
    assert.equal(isValidWebhookSecret(null, undefined), false)
  })

  test("rejects everything when the env var is empty", () => {
    assert.equal(isValidWebhookSecret("", ""), false)
    assert.equal(isValidWebhookSecret("anything", ""), false)
  })

  test("does not throw on a length mismatch (timingSafeEqual would)", () => {
    assert.doesNotThrow(() => isValidWebhookSecret("short", SECRET))
  })

  test("handles multi-byte input without throwing", () => {
    assert.doesNotThrow(() => isValidWebhookSecret("émoji🔐", SECRET))
    assert.equal(isValidWebhookSecret("émoji🔐", SECRET), false)
  })
})

describe("serverError / upstreamError", () => {
  test("serverError never puts the original message in the body", async () => {
    const err = new Error("relation \"public.users\" does not exist")
    const res = serverError("test", err)
    assert.equal(res.status, 500)
    const body = await res.json() as { error: string }
    assert.equal(body.error, "Internal server error")
    assert.ok(!body.error.includes("relation"), "leaked the driver message")
  })

  test("serverError keeps the `error` key eight client call sites branch on", async () => {
    const body = await serverError("test", new Error("x")).json() as Record<string, unknown>
    assert.equal(typeof body.error, "string")
  })

  test("serverError honours a caller-supplied status", () => {
    assert.equal(serverError("test", new Error("x"), 502).status, 502)
  })

  test("upstreamError passes the exchange's own message through", async () => {
    const res = upstreamError("balance", new Error("Incorrect apiKey"))
    assert.equal(res.status, 502)
    assert.equal((await res.json() as { error: string }).error, "Incorrect apiKey")
  })

  test("upstreamError bounds a hostile upstream message", async () => {
    const res = upstreamError("balance", new Error("x".repeat(5000)))
    const body = await res.json() as { error: string }
    assert.equal(body.error.length, 200)
  })

  test("upstreamError copes with a non-Error throw", async () => {
    const body = await upstreamError("balance", "plain string").json() as { error: string }
    assert.equal(body.error, "plain string")
  })
})

describe("link-preview crawler detection", () => {
  const ua = (v: string) => new Headers({ "user-agent": v })

  test("Telegram's preview crawler is recognised", () => {
    // The exact UA that redeemed a live login token in production.
    assert.equal(isLinkPreviewCrawler(ua("TelegramBot (like TwitterBot)")), true)
  })

  test("the other messengers that unfurl links are recognised", () => {
    for (const v of [
      "WhatsApp/2.23.20.0 A",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "facebookexternalhit/1.1",
      "Twitterbot/1.0",
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
    ]) {
      assert.equal(isLinkPreviewCrawler(ua(v)), true, `missed: ${v}`)
    }
  })

  test("real browsers are never treated as crawlers", () => {
    for (const v of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/121.0",
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
    ]) {
      assert.equal(isLinkPreviewCrawler(ua(v)), false, `false positive: ${v}`)
    }
  })

  test("a missing user-agent is not assumed to be a crawler", () => {
    assert.equal(isLinkPreviewCrawler(new Headers()), false)
  })
})
