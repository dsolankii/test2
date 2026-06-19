import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/*": [
      "./scripts/**/*",
      "./node_modules/@vercel/blob/**/*",
      "./node_modules/@vercel/blob/**/package.json"
    ],
  },
};

export default nextConfig;
