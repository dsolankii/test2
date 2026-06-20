import type { NextConfig } from "next";

const tracedRuntimeFiles = [
  "./scripts/**/*",
  "./package.json",
  "./package-lock.json",

  "./node_modules/@vercel/blob/**/*",
  "./node_modules/is-node-process/**/*",
  "./node_modules/fetch-blob/**/*",
  "./node_modules/formdata-polyfill/**/*",
  "./node_modules/node-domexception/**/*",
  "./node_modules/web-streams-polyfill/**/*",

  "./node_modules/dotenv/**/*",
  "./node_modules/jsonrepair/**/*",
  "./node_modules/papaparse/**/*",
  "./node_modules/zod/**/*",
  "./node_modules/zod-to-json-schema/**/*"
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/*": tracedRuntimeFiles,
    "/api/**/*": tracedRuntimeFiles
  }
};

export default nextConfig;
