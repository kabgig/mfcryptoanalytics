import { hmacHex } from "@/lib/crypto/hmac"

const RECV_WINDOW = "5000"

/**
 * Signs a Bybit V5 GET request.
 * Signature string: timestamp + apiKey + recvWindow + queryString
 * Returns the four required auth headers.
 */
export async function buildAuthHeaders(
  queryString: string,
  apiKey: string,
  apiSecret: string
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString()

  const preSign = `${timestamp}${apiKey}${RECV_WINDOW}${queryString}`
  const signature = await hmacHex(apiSecret, preSign)

  return {
    "X-BAPI-API-KEY": apiKey,
    "X-BAPI-TIMESTAMP": timestamp,
    "X-BAPI-RECV-WINDOW": RECV_WINDOW,
    "X-BAPI-SIGN": signature,
  }
}
