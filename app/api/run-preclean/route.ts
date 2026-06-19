import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { runLocalScript } from "@/lib/run-local-script";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCompanyName(row: Record<string, any>) {
  return String(row.companyName || row.company || row.name || "").trim();
}

async function readRows(fileName: string) {
  try {
    const raw = await readFile(dataPath(fileName), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  applyWorkspaceToRequest(request);
  try {
    const result = await runLocalScript("scripts/preclean-real-sources.mjs", 10 * 60 * 1000);

    const rawRows = await readRows("real-source-mentions.json");
    const acceptedRows = await readRows("real-source-mentions-preclean.json");
    const rejectedRows = await readRows("real-source-mentions-rejected-preclean.json");

    const companies = new Set(
      acceptedRows
        .map((row) => getCompanyName(row))
        .filter(Boolean)
        .map((name) => name.toLowerCase())
    );

    return NextResponse.json({
      ok: true,
      rawMentions: rawRows.length,
      acceptedMentions: acceptedRows.length,
      rejectedRows: rejectedRows.length,
      companiesReady: companies.size,
      logs: [result.stdout, result.stderr].filter(Boolean),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Pre-cleaning failed",
      },
      { status: 500 }
    );
  }
}
