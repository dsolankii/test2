import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": [
      "./scripts/**/*",
      "./package.json",
      "./package-lock.json",
      "./node_modules/@google/genai/**/*",
      "./node_modules/dotenv/**/*",
      "./node_modules/jsonrepair/**/*",
      "./node_modules/papaparse/**/*",
      "./node_modules/zod/**/*",
      "./node_modules/zod-to-json-schema/**/*"
    ]
  }
};

export default nextConfig;
