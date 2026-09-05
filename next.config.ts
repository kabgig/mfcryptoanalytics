import type { NextConfig } from "next";

/**
 * Content-Security-Policy, report-only for now.
 *
 * Report-only so a wrong directive cannot break the wallet flow: Reown/WalletConnect
 * opens WebSockets to relay hosts, three.js compiles shaders, and next/font pulls
 * from the Google font hosts. Watch the browser console for violations, widen the
 * few that are legitimate, then switch the header name to `Content-Security-Policy`.
 *
 * `'unsafe-eval'` and `'unsafe-inline'` are in script-src because Next's dev overlay
 * and the wallet SDKs need them today. Tightening those is the point of running
 * report-only first.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https://verify.walletconnect.org https://verify.walletconnect.com",
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
  { key: "Content-Security-Policy-Report-Only", value: csp },
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
