import { createHmac } from "crypto"

/**
 * Builds a signed query string for BingX API requests.
 *
 * BingX auth scheme:
 *   1. Sort all param keys alphabetically
 *   2. Join as "key=val&key2=val2"
 *   3. Append "&timestamp=<ms>" (or "timestamp=<ms>" if no other params)
 *   4. HMAC-SHA256 the resulting string with the secret key
 *   5. Append "&signature=<hex>" to the query string
 *
 * The API key is sent in the X-BX-APIKEY header.
 */
export function buildSignedQuery(
  params: Record<string, string>,
  apiSecret: string
): string {
  const timestamp = Date.now().toString()

  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&")

  const queryWithTs = sorted ? `${sorted}&timestamp=${timestamp}` : `timestamp=${timestamp}`

  const signature = createHmac("sha256", apiSecret)
    .update(queryWithTs)
    .digest("hex")

  return `${queryWithTs}&signature=${signature}`
}
