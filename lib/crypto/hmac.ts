/**
 * Browser-compatible HMAC-SHA256 helpers using the Web Crypto API.
 * These replace Node's `createHmac` so adapter code can run client-side.
 */

const enc = new TextEncoder()

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
}

/** Returns HMAC-SHA256 as a lowercase hex string. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await importKey(secret)
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** Returns HMAC-SHA256 as a base64 string (used by OKX). */
export async function hmacBase64(secret: string, message: string): Promise<string> {
  const key = await importKey(secret)
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}
