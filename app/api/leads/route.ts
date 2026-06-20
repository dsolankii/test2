import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir, stat } from "fs/promises";
import path from "path";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";
import { runLocalScript } from "@/lib/run-local-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function makePaths() {
  return {
    statePath: dataPath("leadgrid-visible-state.json"),
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

async function readState() {
  const { statePath } = makePaths();

  try {
    const raw = await readFile(statePath, "utf8");
    const state = JSON.parse(raw);

    return {
      currentPage: Number.isFinite(Number(state.currentPage)) ? Number(state.currentPage) : 0,
      maxUnlockedPage: Number.isFinite(Number(state.maxUnlockedPage)) ? Number(state.maxUnlockedPage) : 0,
      pageSize: Number.isFinite(Number(state.pageSize)) ? Number(state.pageSize) : 50,
    };
  } catch {
    const state = {
      currentPage: 0,
      maxUnlockedPage: 0,
      pageSize: 50,
    };

    await writeState(state);
    return state;
  }
}

async function writeState(state: { currentPage: number; maxUnlockedPage: number; pageSize: number }) {
  const { statePath } = makePaths();
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
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

function sortByReviewOrder(rows: Record<string, any>[]) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const seqA = Number(a.row.aiEnrichedSeq || 0);
      const seqB = Number(b.row.aiEnrichedSeq || 0);

      if (seqA > 0 && seqB > 0 && seqA !== seqB) return seqA - seqB;
      if (seqA > 0 && seqB <= 0) return -1;
      if (seqB > 0 && seqA <= 0) return 1;

      return a.index - b.index;
    })
    .map((item) => item.row);
}

export async function GET(request: Request) {
  applyWorkspaceToRequest(request);

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
  }

  const { dashboardPath, precleanPath } = makePaths();

  const dashboardRows = await readJsonArray(dashboardPath);
  const precleanRows = await readJsonArray(precleanPath);
  const sortedLeads = sortByReviewOrder(dashboardRows);

  const state = await readState();
  const pageSize = state.pageSize || 50;

  const totalAvailable = sortedLeads.length;
  const candidateTotal = precleanRows.length;
  const pendingReview = Math.max(candidateTotal - totalAvailable, 0);
  const totalPages = Math.max(Math.ceil(totalAvailable / pageSize), 1);

  const maxUnlockedPage = Math.min(
    Math.max(state.maxUnlockedPage, 0),
    totalPages - 1
  );

  const currentPage = Math.min(
    Math.max(state.currentPage, 0),
    maxUnlockedPage
  );

  if (
    currentPage !== state.currentPage ||
    maxUnlockedPage !== state.maxUnlockedPage ||
    pageSize !== state.pageSize
  ) {
    await writeState({
      currentPage,
      maxUnlockedPage,
      pageSize,
    });

    if (process.env.VERCEL) {
      await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
    }
  }

  const startIndex = currentPage * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalAvailable);
  const pageLeads = sortedLeads.slice(startIndex, endIndex);

  const canUnlockNext = pendingReview > 0;

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
        canUnlockNext,
        nextStart: canUnlockNext ? totalAvailable + 1 : 0,
        nextEnd: canUnlockNext ? Math.min(totalAvailable + pageSize, candidateTotal) : 0,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
