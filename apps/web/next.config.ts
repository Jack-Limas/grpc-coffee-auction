import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The generated gRPC contract is shared TypeScript source from the monorepo.
  transpilePackages: ["@cafe/contracts"],
  reactStrictMode: true,
};

export default nextConfig;
