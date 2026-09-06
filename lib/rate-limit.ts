/**
 * Per-IP sliding-window rate limiting, in memory.
 *
 * Deliberately dependency-free. The reference design uses Upstash Redis so counts
 * are shared across instances; that needs a paid service and a new dependency, so
 * this is the honest local equivalent: it is per-instance, which means a
 * distributed attacker gets one bucket per serverless instance. That still stops
 * a single host hammering the credential endpoints, which is the realistic threat
 * here. Swap the store for Redis when precise counts start to matter.
 *
 * Everything fails open. Rate limiting is a safety layer, never a single point of
 * failure — a bug in here must not be able to take the app down.
 */

interface Bucket {
  hits: number[]
  /** Set when the bucket is over budget, so repeat offenders are rejected cheaply. */
  blockedUntil: number
}

const buckets = new Map<string, Bucket>()

/** Safety valve: clear rather than grow without bound under a spray attack. */
const MAX_TRACKED_KEYS = 10_000

export interface RateLimitTier {
  /** Requests allowed within the window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

/** Credential endpoints — anything that can mint or exchange a session. */
export const STRICT: RateLimitTier = { limit: 10, windowMs: 60_000 }
/** Public reads that are cheap but enumerable. */
export const MODERATE: RateLimitTier = { limit: 60, windowMs: 60_000 }

export interface RateLimitResult {
  ok: boolean
  /** Seconds the caller should wait, for Retry-After. */
  retryAfter: number
}

export function rateLimit(key: string, tier: RateLimitTier): RateLimitResult {
  try {
    const now = Date.now()

    if (buckets.size > MAX_TRACKED_KEYS) buckets.clear()

    const bucket = buckets.get(key) ?? { hits: [], blockedUntil: 0 }

    if (bucket.blockedUntil > now) {
      return { ok: false, retryAfter: Math.ceil((bucket.blockedUntil - now) / 1000) }
    }

    const cutoff = now - tier.windowMs
    bucket.hits = bucket.hits.filter((t) => t > cutoff)
    bucket.hits.push(now)

    if (bucket.hits.length > tier.limit) {
      bucket.blockedUntil = now + tier.windowMs
      buckets.set(key, bucket)
      return { ok: false, retryAfter: Math.ceil(tier.windowMs / 1000) }
    }

    buckets.set(key, bucket)
    return { ok: true, retryAfter: 0 }
  } catch {
    // Fail open, always.
    return { ok: true, retryAfter: 0 }
  }
}

/** Test hook. Not used in request paths. */
export function __resetRateLimit() {
  buckets.clear()
}
