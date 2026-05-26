import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the sqlite db into every serverless function (read-only demo data).
  // Switch to Postgres in production and remove this.
  outputFileTracingIncludes: {
    "/**/*": ["./prisma/dev.db"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.shopify.com" },
      { protocol: "https", hostname: "cdn.shopify.com" },
    ],
  },
};

export default nextConfig;
