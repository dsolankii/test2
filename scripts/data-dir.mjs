import path from "path";

const ROOT = process.cwd();

function safeSegment(value) {
  const cleaned = String(value || "global")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);

  return cleaned || "global";
}

export const BASE_DATA_DIR =
  process.env.LEADGRID_DATA_DIR ||
  (process.env.VERCEL ? "/tmp/leadgrid-data" : path.join(ROOT, "data"));

export const LEADGRID_USER_ID = safeSegment(process.env.LEADGRID_USER_ID || "global");

export const DATA_DIR = path.join(BASE_DATA_DIR, "users", LEADGRID_USER_ID);

export function dataPath(...parts) {
  return path.join(DATA_DIR, ...parts);
}
