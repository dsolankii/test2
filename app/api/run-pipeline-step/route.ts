import { NextResponse } from "next/server";
import { readFile, writeFile, stat } from "fs/promises";
import { runLocalScript } from "@/lib/run-local-script";
import { dataPath } from "@/lib/data-dir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StepName =
  | "collect_sources"
  | "collect_extra"
  | "collect_saas"
  | "preclean"
  | "qualify";

const stepScripts: Record<StepName, string[]> = {
  collect_sources: ["scripts/reset-live-run.mjs", "scripts/collect-sources.mjs"],
  collect_extra: ["scripts/collect-extra-sources.mjs", "scripts/collect-open-rss-sources.mjs"],
  collect_saas: ["scripts/collect-saas-conference-pages.mjs"],
  preclean: ["scripts/clean-source-mentions.mjs", "scripts/preclean-real-sources.mjs"],
  qualify: [
    "scripts/enrich-company-batch-ai.mjs",
    "scripts/build-company-dashboard-dataset.mjs",
  ],
};

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

async function fileVersion(fileName: string) {
  try {
    const info = await stat(dataPath(fileName));
    return info.mtimeMs;
  } catch {
    return Date.now();
  }
}

async function getSourceStats() {
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

  return {
    rawMentions: rows.length,
    sourcesScanned: sources.size,
    uniqueCompanies: companies.size,
    version: await fileVersion("real-source-mentions.json"),
  };
}

async function getPrecleanStats() {
  const rawRows = await readRows("real-source-mentions.json");
  const acceptedRows = await readRows("real-source-mentions-preclean.json");
  const rejectedRows = await readRows("real-source-mentions-rejected-preclean.json");

  const companies = new Set(
    acceptedRows
      .map((row) => getCompanyName(row))
      .filter(Boolean)
      .map((name) => name.toLowerCase())
  );

  return {
    rawMentions: rawRows.length,
    acceptedMentions: acceptedRows.length,
    rejectedRows: rejectedRows.length,
    companiesReady: companies.size,
    version: await fileVersion("real-source-mentions-preclean.json"),
  };
}

async function getQualificationStats() {
  const leads = await readRows("company-dashboard-leads.json");
  const enriched = await readRows("ai-enriched-company-leads.json");

  return {
    reviewedCompanies: enriched.length,
    visibleLeads: Math.min(leads.length, 50),
    totalLeads: leads.length,
    version: await fileVersion("company-dashboard-leads.json"),
  };
}

function cleanName(name: string) {
  return name
    .replace(/Collecting /gi, "")
    .replace(/\.\.\./g, "")
    .replace(/public page/gi, "")
    .replace(/public products page/gi, "")
    .replace(/conference partner\/exhibitor pages/gi, "event pages")
    .replace(/broader conference\/exhibitor pages/gi, "event pages")
    .replace(/ jobs/gi, "")
    .replace(/ API/gi, "")
    .trim();
}

function parseUsefulLogs(stdout: string) {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const logs: string[] = [];
  let currentScanName = "";

  for (const line of lines) {
    const extracted = line.match(/^(.+?) extracted:\s*([0-9]+)/i);
    if (extracted) {
      const name = cleanName(extracted[1]);
      logs.push(`${name} ${extracted[2]}`);
      continue;
    }

    const scanning = line.match(/^Scanning SaaS\/event source:\s*(.+)$/i);
    if (scanning) {
      currentScanName = cleanName(scanning[1]);
      continue;
    }

    const found = line.match(/^found\s*([0-9]+)\s*candidates/i);
    if (found && currentScanName) {
      logs.push(`${currentScanName} ${found[1]}`);
      currentScanName = "";
      continue;
    }

    const total = line.match(/^Final total rows:\s*([0-9]+)/i);
    if (total) {
      logs.push(`Total ${total[1]}`);
      continue;
    }

    const merged = line.match(/^Merged rows:\s*([0-9]+)/i);
    if (merged) {
      logs.push(`Merged ${merged[1]}`);
      continue;
    }

    const rawRows = line.match(/^Raw rows:\s*([0-9]+)/i);
    if (rawRows) {
      logs.push(`Mentions ${rawRows[1]}`);
      continue;
    }

    const accepted = line.match(/^Accepted for .*:\s*([0-9]+)/i);
    if (accepted) {
      logs.push(`Accepted ${accepted[1]}`);
      continue;
    }

    const rejected = line.match(/^Hard rejected.*:\s*([0-9]+)/i);
    if (rejected) {
      logs.push(`Rejected ${rejected[1]}`);
      continue;
    }

    const reviewed = line.match(/^Total .* companies saved:\s*([0-9]+)/i);
    if (reviewed) {
      logs.push(`Reviewed ${reviewed[1]}`);
      continue;
    }

    const dashboard = line.match(/^Final dashboard company rows:\s*([0-9]+)/i);
    if (dashboard) {
      logs.push(`Queue ${dashboard[1]}`);
      continue;
    }

    const succeeded = line.match(/request succeeded for\s*([0-9]+)\s*companies/i);
    if (succeeded) {
      logs.push(`Reviewed +${succeeded[1]}`);
      continue;
    }
  }

  return logs.slice(-18);
}

function getStepLabel(script: string) {
  if (script.includes("reset-live-run")) return "Fresh";
  if (script.includes("collect-sources")) return "Jobs";
  if (script.includes("collect-extra")) return "Web";
  if (script.includes("collect-saas")) return "Events";
  if (script.includes("preclean")) return "Clean";
  if (script.includes("enrich")) return "Review";
  if (script.includes("build-company")) return "Queue";
  return "Step";
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const step = body.step as StepName;

    if (!step || !(step in stepScripts)) {
      return NextResponse.json(
        { ok: false, error: "Invalid step." },
        {
          status: 400,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    const scripts = stepScripts[step];
    const logs: string[] = [];

    for (const script of scripts) {
      logs.push(getStepLabel(script));

      const result = await runLocalScript(
        script,
        step === "qualify" ? 25 * 60 * 1000 : 10 * 60 * 1000
      );

      logs.push(...parseUsefulLogs(result.stdout));
      logs.push(...parseUsefulLogs(result.stderr));
    }

    if (step === "qualify") {
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
    }

    return NextResponse.json(
      {
        ok: true,
        step,
        logs,
        sourceStats: await getSourceStats(),
        precleanStats: await getPrecleanStats(),
        qualificationStats: await getQualificationStats(),
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Step failed",
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
