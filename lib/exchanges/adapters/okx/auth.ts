import { hmacBase64 } from "@/lib/crypto/hmac"

const BASE_URL = "https://www.okx.com"

/**
 * OKX REST API authentication.
 *
 * Pre-hash = timestamp + METHOD.toUpperCase() + requestPath + body
 * Signature = base64(HMAC-SHA256(pre-hash, secret))
 *
 * For GET requests: requestPath includes the full query string.
 * Body is "" for GET, JSON string for POST.
 *
 * Headers: OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP,
 *          OK-ACCESS-PASSPHRASE, Content-Type
 */
export async function buildOKXRequest(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string>,
  apiKey: string,
  apiSecret: string,
  passphrase: string
): Promise<{ url: string; headers: Record<string, string> }> {
  const timestamp = new Date().toISOString().replace(/(\.\d{3})\d*Z/, "$1Z")

  // Build query string for GET requests
  const queryParts = Object.entries(params)
    .filter(([, v]) => v !== "" && v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join("&")

  const requestPath = queryParts ? `${path}?${queryParts}` : path
  const body = ""

  const preHash = timestamp + method + requestPath + body
  const signature = await hmacBase64(apiSecret, preHash)

  return {
    url: `${BASE_URL}${requestPath}`,
    headers: {
      "OK-ACCESS-KEY": apiKey,
      "OK-ACCESS-SIGN": signature,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": passphrase,
      "Content-Type": "application/json",
    },
  }
}
