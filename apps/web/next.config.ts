import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@autopilot/shared-types", "@autopilot/ui"],
  env: {
    NEXT_PUBLIC_BOT_URL: process.env.BOT_URL ?? "http://127.0.0.1:8787",
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve = webpackConfig.resolve ?? {};
    webpackConfig.resolve.fallback = {
      ...(webpackConfig.resolve.fallback ?? {}),
      "@farcaster/miniapp-wagmi-connector": false,
      "@farcaster/mini-app-solana": false,
      "@farcaster/miniapp-sdk": false,
      "@getpara/ethers-v6-integration": false,
      "pino-pretty": false,
    };
    return webpackConfig;
  },
};

export default config;
