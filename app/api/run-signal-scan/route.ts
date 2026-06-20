import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { dataPath } from "@/lib/data-dir";
import {
  WORKSPACE_COOKIE,
  createWorkspaceId,
  setWorkspaceIdForRequest,
} from "@/lib/workspace";
import { runLocalScript } from "@/lib/run-local-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function readJsonArray(filePath: string) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function POST() {
  // Every Fresh Scan starts a brand-new workspace.
  const workspaceId = setWorkspaceIdForRequest(createWorkspaceId());

  // Important: no blob-pull before scan. This must be fresh.
  const reset = await runLocalScript("scripts/reset-all-runtime-data.mjs", 60 * 1000);
  const scan = await runLocalScript("scripts/run-source-scan.mjs", 25 * 60 * 1000);

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
  }

  const rawRows = await readJsonArray(dataPath("real-source-mentions.json"));
  const uniqueCompanies = new Set(
    rawRows
      .map((row: any) => String(row.rawName || row.companyName || "").trim().toLowerCase())
      .filter(Boolean)
  ).size;

  const response = NextResponse.json(
    {
      ok: true,
      workspaceId,
      rawMentions: rawRows.length,
      uniqueCompanies,
      logs: [
        "--- reset-all-runtime-data.mjs ---",
        reset.stdout,
        reset.stderr,
        "--- run-source-scan.mjs ---",
        scan.stdout,
        scan.stderr,
      ].join("\n").slice(-15000),
    },
    { headers: { "Cache-Control": "no-store" } }
  );

  response.cookies.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
