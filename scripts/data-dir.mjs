import path from "path";

const ROOT = process.cwd();

export const DATA_DIR =
  process.env.LEADGRID_DATA_DIR ||
  (process.env.VERCEL ? "/tmp/leadgrid-data" : path.join(ROOT, "data"));

export function dataPath(...parts) {
  return path.join(DATA_DIR, ...parts);
}
