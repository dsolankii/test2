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
    enrichedPath: dataPath("ai-enriched-company-leads.json"),
  };
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

function getTime(lead: Lead) {
  const raw =
    lead.capturedAt ||
    lead.updatedAt ||
    lead.reviewedAt ||
    lead.createdAt ||
    lead.lastSeenAt ||
    lead.lastActivityDate ||
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
  const { dashboardPath, enrichedPath } = makePaths();

  const dashboardRows = await readJsonArray(dashboardPath);
  if (dashboardRows.length > 0) return dashboardRows;

  return await readJsonArray(enrichedPath);
}

async function getDataVersion() {
  const { dashboardPath, enrichedPath } = makePaths();

  try {
    const info = await stat(dashboardPath);
    return info.mtimeMs;
  } catch {
    try {
      const info = await stat(enrichedPath);
      return info.mtimeMs;
    } catch {
      return Date.now();
    }
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
    await mkdir(path.dirname(statePath), { recursive: true });

    const state = {
      currentPage: 0,
      maxUnlockedPage: 0,
      pageSize: 50,
    };

    await writeFile(statePath, JSON.stringify(state, null, 2));
    return state;
  }
}

export async function GET(request: Request) {
  applyWorkspaceToRequest(request);

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
  }

  const allLeads = await readLeads();

  const sortedLeads = [...allLeads].sort((a, b) => {
    const scoreDiff = getScore(b) - getScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return getTime(b) - getTime(a);
  });

  const state = await readState();
  const totalAvailable = sortedLeads.length;
  const totalPages = Math.max(Math.ceil(totalAvailable / state.pageSize), 1);

  const maxUnlockedPage = Math.min(
    Math.max(state.maxUnlockedPage, 0),
    totalPages - 1
  );

  const currentPage = Math.min(
    Math.max(state.currentPage, 0),
    maxUnlockedPage
  );

  const startIndex = currentPage * state.pageSize;
  const endIndex = Math.min(startIndex + state.pageSize, totalAvailable);
  const pageLeads = sortedLeads.slice(startIndex, endIndex);

  const nextPage = Math.min(maxUnlockedPage + 1, totalPages - 1);
  const canUnlockNext = maxUnlockedPage < totalPages - 1;
  const nextStart = canUnlockNext ? nextPage * state.pageSize + 1 : 0;
  const nextEnd = canUnlockNext
    ? Math.min((nextPage + 1) * state.pageSize, totalAvailable)
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
        pageSize: state.pageSize,
        visibleStart: totalAvailable === 0 ? 0 : startIndex + 1,
        visibleEnd: endIndex,
        visibleLeadCount: pageLeads.length,
        scoredVisibleLeads: pageLeads.filter((lead) => getScore(lead) > 0).length,
        hiddenLeft: Math.max(
          totalAvailable - Math.min((maxUnlockedPage + 1) * state.pageSize, totalAvailable),
          0
        ),
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
