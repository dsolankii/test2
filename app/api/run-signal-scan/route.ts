import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";
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

export async function POST(request: Request) {
  applyWorkspaceToRequest(request);

  // Important: no blob-pull here.
  // A new scan means a fully fresh pipeline run.
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

  return NextResponse.json(
    {
      ok: true,
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
}
