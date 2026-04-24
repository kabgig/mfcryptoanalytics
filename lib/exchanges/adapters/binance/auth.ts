import { createHmac } from "crypto"

/**
 * Signs Binance REST API request parameters with HMAC-SHA256.
 * Appends `timestamp` and `signature` to the provided params.
 * Returns a fully-signed URLSearchParams ready to append to a request URL.
 */
export function signParams(
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
