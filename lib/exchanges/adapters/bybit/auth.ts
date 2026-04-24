import { createHmac } from "crypto"

const RECV_WINDOW = "5000"

/**
 * Signs a Bybit V5 GET request.
 * Signature string: timestamp + apiKey + recvWindow + queryString
 * Returns the four required auth headers.
 */
export function buildAuthHeaders(
  queryString: string,
  apiKey: string,
  apiSecret: string
): Record<string, string> {
  const timestamp = Date.now().toString()

  const preSign = `${timestamp}${apiKey}${RECV_WINDOW}${queryString}`
  const signature = createHmac("sha256", apiSecret)
    .update(preSign)
    .digest("hex")

  return {
    "X-BAPI-API-KEY": apiKey,
    "X-BAPI-TIMESTAMP": timestamp,
    "X-BAPI-RECV-WINDOW": RECV_WINDOW,
    "X-BAPI-SIGN": signature,
  }
}
