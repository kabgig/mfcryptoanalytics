import { hmacHex } from "@/lib/crypto/hmac"

/**
 * Signs Binance REST API request parameters with HMAC-SHA256.
 * Appends `timestamp` and `signature` to the provided params.
 * Returns a fully-signed URLSearchParams ready to append to a request URL.
 */
export async function signParams(
  params: Record<string, string | number>,
  secret: string
): Promise<URLSearchParams> {
  const query = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ),
    timestamp: Date.now().toString(),
  })

  const signature = await hmacHex(secret, query.toString())

  query.set("signature", signature)
  return query
}
