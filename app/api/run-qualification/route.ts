import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { runLocalScript } from "@/lib/run-local-script";
import { dataPath } from "@/lib/data-dir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const enrich = await runLocalScript(
      "scripts/enrich-company-batch-ai.mjs",
      25 * 60 * 1000
    );

    const build = await runLocalScript(
      "scripts/build-company-dashboard-dataset.mjs",
      10 * 60 * 1000
    );

    const leads = await readRows("company-dashboard-leads.json");
    const enriched = await readRows("ai-enriched-company-leads.json");

    await writeFile(
      dataPath("leadgrid-visible-state.json"),
      JSON.stringify(
        {
          currentPage: 0,
          maxUnlockedPage: 0,
          pageSize: 50
        },
        null,
        2
      )
    );

    return NextResponse.json({
      ok: true,
      reviewedCompanies: enriched.length,
      visibleLeads: Math.min(leads.length, 50),
      totalLeads: leads.length,
      logs: [enrich.stdout, enrich.stderr, build.stdout, build.stderr].filter(Boolean),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Qualification failed",
      },
      { status: 500 }
    );
  }
}
