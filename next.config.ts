import type { NextConfig } from "next";

/**
 * Content-Security-Policy, enforced.
 *
 * It ran report-only until the violations were actually measured, by driving the
 * app in Chromium with the header rewritten to the enforcing name. Across the
 * landing page, dashboard, /lvs, /spot, /wmon and /viz that produced exactly one
 * kind of violation, 49 times: Reown's web fonts on https://fonts.reown.com,
 * which font-src now allows. Nothing in script-src, connect-src or style-src was
 * blocked, which is why enforcing is safe.
 *
 * `'unsafe-eval'` and `'unsafe-inline'` stay in script-src. Removing them means
 * nonces, and Next only puts a nonce on its inline bootstrap scripts if the
 * middleware rewrites the REQUEST headers — the exact pattern proxy.ts warns
 * against, having already made the dashboard flaky once. So this policy is worth
 * having for what it does block (object-src, base-uri, form-action,
 * frame-ancestors, and any origin not listed), not as XSS-proofing.
 *
 * What the measurement could NOT reach, and where a surprise would come from:
 * the WalletConnect modal and its QR/relay flow, the Telegram in-app browser,
 * /import/jupiter, /viz/shapes, /admin and the share pages.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // fonts.reown.com is the wallet SDK's own typeface — 49 of the 49 violations
  // measured before this was enforced.
  "font-src 'self' data: https://fonts.gstatic.com https://fonts.reown.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https://verify.walletconnect.org https://verify.walletconnect.com",
  // Defensive, not measured: without it worker-src falls back to default-src
  // 'self', and SDKs commonly build workers from blob: URLs. The connect modal
  // could not be driven headlessly, so this stays wide enough not to break it.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  // Two years, subdomains included. `preload` is deliberately omitted: it is a
  // browser-list commitment that is slow to undo, so add it once every subdomain
  // is known to be HTTPS-only.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Nothing in this app is meant to be embedded; exchange API keys live in
  // localStorage, so a clickjacked frame is a real path to them.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Auth-sensitive and per-user reads must never sit in a shared cache.
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
  webpack: (config) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding', 'accounts')
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@coinbase/wallet-sdk': false,
      '@metamask/connect-evm': false,
      'porto': false,
      'porto/internal': false,
      '@walletconnect/ethereum-provider': false,
      '@base-org/account': false,
    }
    return config
  },
};

export default nextConfig;
