/**
 * Bitunix REST API authentication.
 *
 * Signature algorithm (double-SHA256):
 *   1. Sort all GET query params alphabetically by key and concatenate as
 *      key1value1key2value2...  (no separators, e.g. "id1uid200")
 *   2. digest = SHA256(nonce + timestamp + apiKey + queryParams + body)
 *   3. sign   = SHA256(digest + secretKey)
 *
 * Required headers: api-key, nonce (32-char hex), timestamp (ms), sign
 */

const enc = new TextEncoder()

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("") // 32-char hex string
}

/**
 * Builds Bitunix auth headers for a GET request.
 * Returns both the headers and the standard URL query string.
 */
export async function buildAuthHeaders(
  params: Record<string, string | number>,
  apiKey: string,
  secretKey: string
): Promise<{ headers: Record<string, string>; urlQueryString: string }> {
  const nonce = generateNonce()
  const timestamp = Date.now().toString()

  // Signature queryParams: sort by key, concatenate key+value with no separators
  const signQueryParams = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("")

  // URL query string: standard URLSearchParams
  const urlQueryString = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  ).toString()

  const digest = await sha256Hex(nonce + timestamp + apiKey + signQueryParams)
  const sign = await sha256Hex(digest + secretKey)

  return {
    headers: {
      "api-key": apiKey,
      nonce,
      timestamp,
      sign,
      "Content-Type": "application/json",
    },
    urlQueryString,
  }
}
