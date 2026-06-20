import { runLocalScript } from "@/lib/run-local-script";
import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Lead = Record<string, any>;

function escapeCsv(value: unknown) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replaceAll('"', '""')}"`;
}

function getScore(lead: Lead) {
  const raw =
    lead.aiIntentScore ||
    lead.intentScore ||
    lead.score ||
    lead.aiScore ||
    lead.confidenceScore ||
    0;

  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function getCompanyName(lead: Lead) {
  return (
    lead.companyName ||
    lead.company ||
    lead.name ||
    lead.aiCompanyName ||
    lead.accountName ||
    lead.rawName ||
    "Unknown company"
  );
}

function makePaths() {
  return {
    statePath: dataPath("leadgrid-visible-state.json"),
    dashboardPath: dataPath("company-dashboard-leads.json"),
  };
}

async function readState() {
  const { statePath } = makePaths();

  try {
    const raw = await readFile(statePath, "utf8");
    const state = JSON.parse(raw);

    return {
      currentPage: Number.isFinite(Number(state.currentPage))
        ? Number(state.currentPage)
        : 0,
      pageSize: Number.isFinite(Number(state.pageSize))
        ? Number(state.pageSize)
        : 50,
    };
  } catch {
    return {
      currentPage: 0,
      pageSize: 50,
    };
  }
}

async function readJsonArray(filePath: string) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readLeads() {
  const { dashboardPath } = makePaths();
  return await readJsonArray(dashboardPath);
}

export async function GET(request: Request) {
  applyWorkspaceToRequest(request);

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
  }

  const allLeads = await readLeads();
  const state = await readState();

  const sortedLeads = [...allLeads].sort((a, b) => getScore(b) - getScore(a));
  const startIndex = state.currentPage * state.pageSize;
  const visibleLeads = sortedLeads.slice(startIndex, startIndex + state.pageSize);

  const headers = [
    "Company",
    "Decision",
    "Score",
    "ICP Fit",
    "Why Now",
    "Next Action",
    "Source URL",
  ];

  const rows = visibleLeads.map((lead) => [
    getCompanyName(lead),
    lead.aiDecision || lead.decision || lead.status || "",
    getScore(lead),
    lead.aiIcpFit || lead.icpFit || lead.aiBuyerNeed || lead.buyerNeed || "",
    lead.aiWhyNow || lead.whyNow || lead.reason || lead.aiReasoning || "",
    lead.aiNextAction || lead.nextAction || lead.recommendedAction || "",
    lead.sourceUrl || lead.url || lead.link || lead.companyUrl || lead.website || "",
  ]);

  const csv = [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => row.map(escapeCsv).join(",")),
  ].join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="leadgrid-current-page-leads.csv"',
      "Cache-Control": "no-store",
    },
  });
}
