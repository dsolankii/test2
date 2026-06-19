import path from "path";

export const LEADGRID_DATA_DIR =
  process.env.LEADGRID_DATA_DIR ||
  (process.env.VERCEL ? "/tmp/leadgrid-data" : path.join(process.cwd(), "data"));

export function dataPath(...parts: string[]) {
  return path.join(LEADGRID_DATA_DIR, ...parts);
}
