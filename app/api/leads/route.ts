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
    precleanPath: dataPath("real-source-mentions-preclean.json"),
  };
}

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCompanyName(name = "") {
  return clean(name)
    .toLowerCase()
    .replace(/\b(inc|inc\.|llc|ltd|ltd\.|corp|corp\.|corporation|company|co|co\.|limited|plc|gmbh|sa|ag)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCompanyName(row: Lead) {
  return clean(
    row.rawName ||
      row.cleanCompanyName ||
      row.companyName ||
      row.company ||
      row.name ||
      row.organization ||
      row.organisation ||
      row.employer ||
      row.title ||
      ""
  );
}

function getCompanyKey(row: Lead) {
  return clean(row.companyKey) || normalizeCompanyName(getCompanyName(row));
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

async function readCandidateTotal() {
  const { precleanPath } = makePaths();
  const rows = await readJsonArray(precleanPath);
  const keys = new Set<string>();

  for (const row of rows) {
    const key = getCompanyKey(row);
    if (key) keys.add(key);
  }

  return keys.size || rows.length;
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
  const candidateTotal = await readCandidateTotal();

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

  const preparedNextPage = maxUnlockedPage + 1;
  const hasPreparedNextPage = preparedNextPage <= lastPreparedPage;
  const pendingReview = Math.max(candidateTotal - totalAvailable, 0);
  const canUnlockNext = hasPreparedNextPage || pendingReview > 0;

  const nextStart = hasPreparedNextPage
    ? preparedNextPage * pageSize + 1
    : totalAvailable + 1;

  const nextEnd = hasPreparedNextPage
    ? Math.min((preparedNextPage + 1) * pageSize, totalAvailable)
    : Math.min(totalAvailable + pageSize, Math.max(candidateTotal, totalAvailable));

  return NextResponse.json(
    {
      ok: true,
      leads: pageLeads,
      meta: {
        dataVersion: await getDataVersion(),
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
        nextStart: canUnlockNext ? nextStart : 0,
        nextEnd: canUnlockNext ? nextEnd : 0,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
