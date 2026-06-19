import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./scripts/**/*",
      "./package.json",
      "./package-lock.json"
    ],
    "/api/*": [
      "./scripts/**/*",
      "./package.json",
      "./package-lock.json"
    ]
  }
};

export default nextConfig;
