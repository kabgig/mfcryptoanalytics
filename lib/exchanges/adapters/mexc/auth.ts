import { createHmac } from "crypto"

// ── Spot (v3) ─────────────────────────────────────────────────────────────────
// Identical scheme to Binance: append timestamp, HMAC-SHA256 the full query
// string, append &signature=<hex>. Header: X-MEXC-APIKEY.
export function signSpotParams(
  params: Record<string, string | number>,
  secret: string
): URLSearchParams {
  const query = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ),
    timestamp: Date.now().toString(),
  })

  const signature = createHmac("sha256", secret)
    .update(query.toString())
    .digest("hex")

  query.set("signature", signature)
  return query
}

// ── Futures (v1) ──────────────────────────────────────────────────────────────
// Signature = HMAC-SHA256 of accessKey + timestamp + sortedQueryString.
// Delivered in headers: ApiKey, Request-Time, Signature.
export function buildFuturesAuth(
  accessKey: string,
  secretKey: string,
  params: Record<string, string> = {}
): { headers: Record<string, string>; queryString: string } {
  const timestamp = Date.now().toString()
  const queryString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&")

  const toSign = accessKey + timestamp + queryString
  const signature = createHmac("sha256", secretKey).update(toSign).digest("hex")

  return {
    headers: {
      ApiKey: accessKey,
      "Request-Time": timestamp,
      Signature: signature,
      "Content-Type": "application/json",
    },
    queryString,
  }
}
