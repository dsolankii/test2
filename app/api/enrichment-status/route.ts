import { NextResponse } from "next/server";
import fs from "node:fs";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyRow = Record<string, any>;

const PRECLEAN_JSON = dataPath("real-source-mentions-preclean.json");
const REJECTED_JSON = dataPath("real-source-mentions-rejected-preclean.json");
const AI_COMPANY_JSON = dataPath("ai-enriched-company-leads.json");
const DASHBOARD_JSON = dataPath("company-dashboard-leads.json");
const VISIBLE_STATE_JSON = dataPath("ai-visible-state.json");

const BATCH_SIZE = 50;

function readJson(filePath: string, fallback: any = []) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function cleanText(value = "") {
  return String(value)
    .replace(/[�]/g, "")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompanyName(name = "") {
  return cleanText(name)
    .toLowerCase()
    .replace(/\b(inc|inc\.|llc|ltd|ltd\.|corp|corp\.|corporation|company|co|co\.|limited|plc|gmbh|sa|ag)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyKeyFromName(name = "") {
  return normalizeCompanyName(name) || cleanText(name).toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function uniqueCompanyCount(rows: AnyRow[]) {
  const keys = new Set<string>();

  for (const row of rows) {
    const key = row.companyKey || companyKeyFromName(row.rawName || "");
    if (key) keys.add(key);
  }

  return keys.size;
}

function getStatus() {
  const precleanRows = readJson(PRECLEAN_JSON);
  const rejectedRows = readJson(REJECTED_JSON);
  const aiRows = readJson(AI_COMPANY_JSON);
  const dashboardRows = readJson(DASHBOARD_JSON);
  const state = readJson(VISIBLE_STATE_JSON, { visibleAiCount: aiRows.length, batchSize: BATCH_SIZE });

  const totalAcceptedCompanies = uniqueCompanyCount(precleanRows);
  const rejectedCompanies = uniqueCompanyCount(rejectedRows);
  const prefetchedAiCompanies = uniqueCompanyCount(aiRows);
  const visibleAiCompanies = Math.min(Number(state.visibleAiCount || 0), prefetchedAiCompanies);

  const readyToRevealCount = Math.max(0, prefetchedAiCompanies - visibleAiCompanies);
  const pendingAiCompanies = Math.max(0, totalAcceptedCompanies - prefetchedAiCompanies);

  const nextBatchStart =
    visibleAiCompanies >= totalAcceptedCompanies ? null : visibleAiCompanies + 1;

  const nextBatchEnd =
    nextBatchStart === null
      ? null
      : Math.min(totalAcceptedCompanies, visibleAiCompanies + BATCH_SIZE);

  const nextEnrichStart =
    prefetchedAiCompanies >= totalAcceptedCompanies ? null : prefetchedAiCompanies + 1;

  const nextEnrichEnd =
    nextEnrichStart === null
      ? null
      : Math.min(totalAcceptedCompanies, prefetchedAiCompanies + BATCH_SIZE);

  return {
    batchSize: BATCH_SIZE,
    precleanRows: precleanRows.length,
    totalAcceptedCompanies,
    rejectedCompanies,

    aiEnrichedCompanies: visibleAiCompanies,
    visibleAiCompanies,
    prefetchedAiCompanies,
    pendingAiCompanies,
    readyToRevealCount,

    localFallbackCompanies: 0,
    dashboardRows: dashboardRows.length,
    geminiRowsInDashboard: dashboardRows.filter((row: AnyRow) => row.aiGenerated === true).length,

    nextBatchStart,
    nextBatchEnd,
    nextEnrichStart,
    nextEnrichEnd,

    isComplete: visibleAiCompanies >= totalAcceptedCompanies,
    isPrefetchComplete: prefetchedAiCompanies >= totalAcceptedCompanies,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  applyWorkspaceToRequest(request);
  try {
    return NextResponse.json({
      ok: true,
      status: getStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
