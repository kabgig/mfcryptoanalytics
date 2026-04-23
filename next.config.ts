import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
