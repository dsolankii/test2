import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import { dataPath, getLeadgridDataDir, getLeadgridWorkspaceId } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";
import { runLocalScript } from "@/lib/run-local-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const files = [
  "real-source-mentions.json",
  "real-source-mentions-preclean.json",
  "ai-enriched-company-leads.json",
  "company-dashboard-leads.json",
  "leadgrid-visible-state.json",
];

async function inspectFile(file: string) {
  const filePath = dataPath(file);

  try {
    const info = await stat(filePath);
    const raw = await readFile(filePath, "utf8");

    let count: number | null = null;
    try {
      const parsed = JSON.parse(raw);
      count = Array.isArray(parsed) ? parsed.length : null;
    } catch {
      count = null;
    }

    return {
      file,
      exists: true,
      bytes: info.size,
      count,
      path: filePath,
      preview: raw.slice(0, 250),
    };
  } catch {
    return {
      file,
      exists: false,
      bytes: 0,
      count: null,
      path: filePath,
      preview: "",
    };
  }
}

export async function GET(request: Request) {
  const workspaceId = applyWorkspaceToRequest(request);

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
  }

  const results = await Promise.all(files.map(inspectFile));

  return NextResponse.json(
    {
      ok: true,
      workspaceId,
      resolvedWorkspaceId: getLeadgridWorkspaceId(),
      dataDir: getLeadgridDataDir(),
      blobPrefix: `${process.env.LEADGRID_BLOB_PREFIX || "leadgrid/data"}/users/${getLeadgridWorkspaceId()}`,
      files: results,
      hint:
        results.find((file) => file.file === "company-dashboard-leads.json")?.count
          ? "Dashboard leads exist. /leads should show cards."
          : "No dashboard leads yet. Run console pipeline: scan, clean, review, build.",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
