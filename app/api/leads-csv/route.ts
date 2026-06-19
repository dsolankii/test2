

import { runLocalScript } from "@/lib/run-local-script";
import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";

const STATE_PATH = dataPath("leadgrid-visible-state.json");
const LEADS_PATH = dataPath("company-dashboard-leads.json");

function escapeCsv(value: unknown) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replaceAll('"', '""')}"`;
}

function getScore(lead: Record<string, any>) {
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

function getCompanyName(lead: Record<string, any>) {
  return (
    lead.companyName ||
    lead.company ||
    lead.name ||
    lead.aiCompanyName ||
    lead.accountName ||
    "Unknown company"
  );
}

async function readState() {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const state = JSON.parse(raw);

    return {
      currentPage: Number.isFinite(Number(state.currentPage)) ? Number(state.currentPage) : 0,
      pageSize: Number.isFinite(Number(state.pageSize)) ? Number(state.pageSize) : 50,
    };
  } catch {
    return { currentPage: 0, pageSize: 50 };
  }
}

export async function GET(request: Request) {
  applyWorkspaceToRequest(request);
  if (process.env.VERCEL) await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
  try {
    const raw = await readFile(LEADS_PATH, "utf8");
    const allLeads = JSON.parse(raw);
    const leads = Array.isArray(allLeads) ? allLeads : [];

    const state = await readState();
    const sortedLeads = [...leads].sort((a, b) => getScore(b) - getScore(a));
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
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "CSV export failed." },
      { status: 404 }
    );
  }
}
