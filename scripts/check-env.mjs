import dotenv from "dotenv";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

dotenv.config({ path: ".env.local", quiet: true });

function mask(value) {
  if (!value) return "missing";
  if (value.length <= 8) return "set";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

console.log("Environment check");
console.log("-----------------");
console.log(`AI_PROVIDER: ${process.env.AI_PROVIDER || "missing"}`);
console.log(`AI_API_KEY: ${mask(process.env.AI_API_KEY)}`);
console.log(`AI_MODEL: ${process.env.AI_MODEL || "missing"}`);
console.log(`AI_FALLBACK_MODELS: ${process.env.AI_FALLBACK_MODELS || "missing"}`);
console.log(`AI_LIMIT: ${process.env.AI_LIMIT || "missing"}`);
console.log(`AI_DELAY_MS: ${process.env.AI_DELAY_MS || "missing"}`);
console.log(`ADZUNA_APP_ID: ${mask(process.env.ADZUNA_APP_ID)}`);
console.log(`ADZUNA_APP_KEY: ${mask(process.env.ADZUNA_APP_KEY)}`);
console.log(`PRODUCT_HUNT_TOKEN: ${mask(process.env.PRODUCT_HUNT_TOKEN)}`);
