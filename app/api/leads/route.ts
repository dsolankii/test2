import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";
import { runLocalScript } from "@/lib/run-local-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function makePaths() {
  return {
    dashboardPath: dataPath("company-dashboard-leads.json"),
    precleanPath: dataPath("real-source-mentions-preclean.json"),
  };
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

async function getDataVersion(filePath: string) {
  try {
    const info = await stat(filePath);
    return info.mtimeMs;
  } catch {
    return Date.now();
  }
}

function getScore(lead: Record<string, any>) {
  const value = Number(
    lead.aiIntentScore ??
      lead.intentScore ??
      lead.score ??
      lead.aiScore ??
      0
  );

  return Number.isFinite(value) ? value : 0;
}

function sortByBatchThenScore(rows: Record<string, any>[]) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const seqA = Number(a.row.aiEnrichedSeq || 0);
      const seqB = Number(b.row.aiEnrichedSeq || 0);

      const batchA = seqA > 0 ? Math.floor((seqA - 1) / 50) : Number.MAX_SAFE_INTEGER;
      const batchB = seqB > 0 ? Math.floor((seqB - 1) / 50) : Number.MAX_SAFE_INTEGER;

      // Keep 1-50, 51-100, 101-150 as fixed reviewed batches.
      if (batchA !== batchB) return batchA - batchB;

      // Inside each 50 batch, show strongest leads first.
      const scoreA = getScore(a.row);
      const scoreB = getScore(b.row);
      if (scoreA !== scoreB) return scoreB - scoreA;

      const confidenceA = Number(a.row.aiConfidence || a.row.confidence || 0);
      const confidenceB = Number(b.row.aiConfidence || b.row.confidence || 0);
      if (confidenceA !== confidenceB) return confidenceB - confidenceA;

      if (seqA > 0 && seqB > 0 && seqA !== seqB) return seqA - seqB;

      return a.index - b.index;
    })
    .map((item) => item.row);
}

export async function GET(request: Request) {
  applyWorkspaceToRequest(request);

  // Vercel serverless /tmp is not shared across requests.
  // Pull current workspace files before read-only display.
  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
  }

  const url = new URL(request.url);
  const requestedPage = Number(url.searchParams.get("page") || 0);

  const { dashboardPath, precleanPath } = makePaths();

  const dashboardRows = await readJsonArray(dashboardPath);
  const precleanRows = await readJsonArray(precleanPath);
  const sortedLeads = sortByBatchThenScore(dashboardRows);

  const pageSize = 50;
  const totalAvailable = sortedLeads.length;
  const candidateTotal = precleanRows.length;
  const pendingReview = Math.max(candidateTotal - totalAvailable, 0);
  const totalPages = Math.max(Math.ceil(totalAvailable / pageSize), 1);
  const maxUnlockedPage = Math.max(totalPages - 1, 0);

  const currentPage = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 0, 0),
    maxUnlockedPage
  );

  const startIndex = currentPage * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalAvailable);
  const pageLeads = sortedLeads.slice(startIndex, endIndex);

  return NextResponse.json(
    {
      ok: true,
      leads: pageLeads,
      meta: {
        dataVersion: await getDataVersion(dashboardPath),
        totalAvailable,
        candidateTotal,
        pendingReview,
        reviewedPercent:
          candidateTotal > 0 ? Math.round((totalAvailable / candidateTotal) * 100) : 0,
        totalPages,
        currentPage,
        maxUnlockedPage,
        pageSize,
        visibleStart: totalAvailable === 0 ? 0 : startIndex + 1,
        visibleEnd: endIndex,
        visibleLeadCount: pageLeads.length,
        scoredVisibleLeads: pageLeads.filter((lead) => getScore(lead) > 0).length,
        hiddenLeft: pendingReview,
        canGoPrev: currentPage > 0,
        canGoNext: currentPage < maxUnlockedPage,
        canUnlockNext: pendingReview > 0,
        nextStart: pendingReview > 0 ? totalAvailable + 1 : 0,
        nextEnd: pendingReview > 0 ? Math.min(totalAvailable + pageSize, candidateTotal) : 0,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
