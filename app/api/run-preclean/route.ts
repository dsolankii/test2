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

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
  }

  const rawRowsBefore = await readJsonArray(dataPath("real-source-mentions.json"));

  if (rawRowsBefore.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Pre-clean refused because raw extraction is empty. Run Fresh Scan first. This prevents wiping good reviewed/dashboard data.",
        rawMentions: 0,
        acceptedMentions: 0,
        rejectedRows: 0,
        companiesReady: 0,
      },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Keep fresh raw extraction, but clear old preclean/review/dashboard outputs.
  const reset = await runLocalScript("scripts/reset-after-scan-data.mjs", 60 * 1000);
  const preclean = await runLocalScript("scripts/preclean-real-sources.mjs", 10 * 60 * 1000);

  const rawRows = await readJsonArray(dataPath("real-source-mentions.json"));
  const acceptedRows = await readJsonArray(dataPath("real-source-mentions-preclean.json"));
  const rejectedRows = await readJsonArray(dataPath("real-source-mentions-rejected-preclean.json"));

  if (acceptedRows.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Pre-clean produced 0 accepted rows. Refusing to push empty pre-clean data.",
        rawMentions: rawRows.length,
        acceptedMentions: 0,
        rejectedRows: rejectedRows.length,
        companiesReady: 0,
        logs: [
          "--- reset-after-scan-data.mjs ---",
          reset.stdout,
          reset.stderr,
          "--- preclean-real-sources.mjs ---",
          preclean.stdout,
          preclean.stderr,
        ].join("\n").slice(-12000),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
  }

  return NextResponse.json(
    {
      ok: true,
      rawMentions: rawRows.length,
      acceptedMentions: acceptedRows.length,
      rejectedRows: rejectedRows.length,
      companiesReady: new Set(
        acceptedRows
          .map((row: any) => String(row.rawName || row.companyName || "").trim().toLowerCase())
          .filter(Boolean)
      ).size,
      logs: [
        "--- reset-after-scan-data.mjs ---",
        reset.stdout,
        reset.stderr,
        "--- preclean-real-sources.mjs ---",
        preclean.stdout,
        preclean.stderr,
      ].join("\n").slice(-12000),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
