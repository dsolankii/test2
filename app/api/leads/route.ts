import { runLocalScript } from "@/lib/run-local-script";
import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir, stat } from "fs/promises";
import path from "path";
import { dataPath } from "@/lib/data-dir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_PATH = dataPath("leadgrid-visible-state.json");
const LEADS_PATH = dataPath("company-dashboard-leads.json");

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


function getTime(lead: Record<string, any>) {
  const raw =
    lead.capturedAt ||
    lead.updatedAt ||
    lead.reviewedAt ||
    lead.createdAt ||
    lead.lastSeenAt ||
    "";

  const value = Date.parse(String(raw));
  return Number.isFinite(value) ? value : 0;
}


async function getDataVersion() {
  try {
    const info = await stat(LEADS_PATH);
    return info.mtimeMs;
  } catch {
    return Date.now();
  }
}

async function readState() {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const state = JSON.parse(raw);

    return {
      currentPage: Number.isFinite(Number(state.currentPage)) ? Number(state.currentPage) : 0,
      maxUnlockedPage: Number.isFinite(Number(state.maxUnlockedPage)) ? Number(state.maxUnlockedPage) : 0,
      pageSize: Number.isFinite(Number(state.pageSize)) ? Number(state.pageSize) : 50,
    };
  } catch {
    await mkdir(path.dirname(STATE_PATH), { recursive: true });
    const state = { currentPage: 0, maxUnlockedPage: 0, pageSize: 50 };
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
    return state;
  }
}

export async function GET() {
  if (process.env.VERCEL) await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
  try {
    const raw = await readFile(LEADS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const allLeads = Array.isArray(parsed) ? parsed : [];

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
    const hasNextPrepared = maxUnlockedPage < totalPages - 1;
    const nextStart = hasNextPrepared ? nextPage * state.pageSize + 1 : 0;
    const nextEnd = hasNextPrepared
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
          canUnlockNext: hasNextPrepared,
          nextStart,
          nextEnd,
        },
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch {
    return NextResponse.json(
      {
        ok: true,
        leads: [],
        meta: {
          dataVersion: Date.now(),
          totalAvailable: 0,
          totalPages: 1,
          currentPage: 0,
          maxUnlockedPage: 0,
          pageSize: 50,
          visibleStart: 0,
          visibleEnd: 0,
          visibleLeadCount: 0,
          scoredVisibleLeads: 0,
          hiddenLeft: 0,
          canGoPrev: false,
          canGoNext: false,
          canUnlockNext: false,
          nextStart: 0,
          nextEnd: 0,
        },
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
