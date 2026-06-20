import { runLocalScript } from "@/lib/run-local-script";
import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir, stat } from "fs/promises";
import path from "path";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Lead = Record<string, any>;

function makePaths() {
  return {
    statePath: dataPath("leadgrid-visible-state.json"),
    dashboardPath: dataPath("company-dashboard-leads.json"),
  };
}

function getScore(lead: Lead) {
  const raw =
    lead.aiIntentScore ||
    lead.score ||
    lead.intentScore ||
    lead.aiScore ||
    0;

  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function getTime(lead: Lead) {
  const raw =
    lead.capturedAt ||
    lead.aiReviewedAt ||
    lead.updatedAt ||
    lead.reviewedAt ||
    lead.createdAt ||
    "";

  const value = Date.parse(String(raw));
  return Number.isFinite(value) ? value : 0;
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

async function getDataVersion() {
  const { dashboardPath } = makePaths();

  try {
    const info = await stat(dashboardPath);
    return info.mtimeMs;
  } catch {
    return Date.now();
  }
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
      maxUnlockedPage: Number.isFinite(Number(state.maxUnlockedPage))
        ? Number(state.maxUnlockedPage)
        : 0,
      pageSize: Number.isFinite(Number(state.pageSize))
        ? Number(state.pageSize)
        : 50,
    };
  } catch {
    return {
      currentPage: 0,
      maxUnlockedPage: 0,
      pageSize: 50,
    };
  }
}

async function writeState(state: { currentPage: number; maxUnlockedPage: number; pageSize: number }) {
  const { statePath } = makePaths();
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

export async function GET(request: Request) {
  applyWorkspaceToRequest(request);

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
  }

  const url = new URL(request.url);
  const shouldReset = url.searchParams.get("reset") === "1";

  const allLeads = await readLeads();

  const sortedLeads = [...allLeads].sort((a, b) => {
    const scoreDiff = getScore(b) - getScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return getTime(b) - getTime(a);
  });

  const rawState = await readState();
  const pageSize = rawState.pageSize || 50;
  const totalAvailable = sortedLeads.length;
  const totalPages = Math.max(Math.ceil(totalAvailable / pageSize), 1);
  const lastPreparedPage = Math.max(totalPages - 1, 0);

  let maxUnlockedPage = shouldReset
    ? 0
    : Math.min(Math.max(rawState.maxUnlockedPage, 0), lastPreparedPage);

  let currentPage = shouldReset
    ? 0
    : Math.min(Math.max(rawState.currentPage, 0), maxUnlockedPage);

  if (totalAvailable === 0) {
    currentPage = 0;
    maxUnlockedPage = 0;
  }

  const normalizedState = {
    currentPage,
    maxUnlockedPage,
    pageSize,
  };

  if (
    shouldReset ||
    rawState.currentPage !== normalizedState.currentPage ||
    rawState.maxUnlockedPage !== normalizedState.maxUnlockedPage ||
    rawState.pageSize !== normalizedState.pageSize
  ) {
    await writeState(normalizedState);

    if (process.env.VERCEL) {
      await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
    }
  }

  const startIndex = currentPage * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalAvailable);
  const pageLeads = sortedLeads.slice(startIndex, endIndex);

  const nextPage = Math.min(maxUnlockedPage + 1, lastPreparedPage);
  const canUnlockNext = maxUnlockedPage < lastPreparedPage;
  const nextStart = canUnlockNext ? nextPage * pageSize + 1 : 0;
  const nextEnd = canUnlockNext
    ? Math.min((nextPage + 1) * pageSize, totalAvailable)
    : 0;

  return NextResponse.json(
    {
      ok: true,
      leads: pageLeads,
      meta: {
        dataVersion: await getDataVersion(),
        totalAvailable,
        totalPages,
        currentPage,
        maxUnlockedPage,
        pageSize,
        visibleStart: totalAvailable === 0 ? 0 : startIndex + 1,
        visibleEnd: endIndex,
        visibleLeadCount: pageLeads.length,
        scoredVisibleLeads: pageLeads.filter((lead) => getScore(lead) > 0).length,
        hiddenLeft: Math.max(totalAvailable - endIndex, 0),
        canGoPrev: currentPage > 0,
        canGoNext: currentPage < maxUnlockedPage,
        canUnlockNext,
        nextStart,
        nextEnd,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
