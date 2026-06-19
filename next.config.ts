import type { NextConfig } from "next";

const tracedRuntimeFiles = [
  "./scripts/**/*",
  "./node_modules/**/*",
  "./package.json",
  "./package-lock.json"
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/**/*": tracedRuntimeFiles,
    "/api/*": tracedRuntimeFiles
  }
};

export default nextConfig;
