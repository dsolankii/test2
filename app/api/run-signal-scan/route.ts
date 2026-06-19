import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { runLocalScript, scriptExists } from "@/lib/run-local-script";
import { dataPath } from "@/lib/data-dir";

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

export async function POST() {
  try {
    const scripts = [
      "scripts/collect-sources.mjs",
      "scripts/collect-extra-sources.mjs",
      "scripts/collect-saas-conference-pages.mjs",
    ];

    const logs: string[] = [];

    for (const script of scripts) {
      if (!(await scriptExists(script))) {
        logs.push(`Skipped missing script: ${script}`);
        continue;
      }

      logs.push(`Running ${script}`);
      const result = await runLocalScript(script, 10 * 60 * 1000);

      if (result.stdout) logs.push(result.stdout);
      if (result.stderr) logs.push(result.stderr);
    }

    const rows = await readRows("real-source-mentions.json");

    const companies = new Set(
      rows
        .map((row) => getCompanyName(row))
        .filter(Boolean)
        .map((name) => name.toLowerCase())
    );

    const sources = new Set(
      rows
        .map((row) =>
          String(row.sourceName || row.source || row.sourceType || "").trim()
        )
        .filter(Boolean)
    );

    return NextResponse.json({
      ok: true,
      rawMentions: rows.length,
      sourcesScanned: sources.size,
      uniqueCompanies: companies.size,
      logs,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Signal scan failed",
      },
      { status: 500 }
    );
  }
}
