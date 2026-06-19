import path from "path";

function safeSegment(value: string | undefined | null) {
  const cleaned = String(value || "global")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);

  return cleaned || "global";
}

export const LEADGRID_BASE_DATA_DIR =
  process.env.LEADGRID_DATA_DIR ||
  (process.env.VERCEL ? "/tmp/leadgrid-data" : path.join(process.cwd(), "data"));

export function getLeadgridWorkspaceId() {
  return safeSegment(process.env.LEADGRID_USER_ID || "global");
}

export function getLeadgridDataDir() {
  return path.join(LEADGRID_BASE_DATA_DIR, "users", getLeadgridWorkspaceId());
}

export const LEADGRID_DATA_DIR = getLeadgridDataDir();

export function dataPath(...parts: string[]) {
  return path.join(getLeadgridDataDir(), ...parts);
}
