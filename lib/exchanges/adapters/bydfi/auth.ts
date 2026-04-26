import { hmacHex } from "@/lib/crypto/hmac"

/**
 * BYDFi REST API authentication.
 *
 * Signature: HMAC-SHA256(secretKey, accessKey + timestamp + queryString + body)
 * Headers: X-API-KEY, X-API-TIMESTAMP, X-API-SIGNATURE, Content-Type
 *
 * Docs: https://developers.bydfi.com/en/signature
 */
export async function buildAuthHeaders(
  queryString: string,
  apiKey: string,
  secretKey: string,
  body = ""
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString()
  const preSign = apiKey + timestamp + queryString + body
  const signature = await hmacHex(secretKey, preSign)

  return {
    "X-API-KEY": apiKey,
    "X-API-TIMESTAMP": timestamp,
    "X-API-SIGNATURE": signature,
    "Content-Type": "application/json",
  }
}
