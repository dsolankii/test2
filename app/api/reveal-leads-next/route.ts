import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { runLocalScript } from "@/lib/run-local-script";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function makePaths() {
  return {
    statePath: dataPath("leadgrid-visible-state.json"),
    dashboardPath: dataPath("company-dashboard-leads.json"),
    precleanPath: dataPath("real-source-mentions-preclean.json"),
    aiPath: dataPath("ai-enriched-company-leads.json"),
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

export async function POST(request: Request) {
  applyWorkspaceToRequest(request);

  try {
    if (process.env.VERCEL) {
      await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
    }

    const { dashboardPath, precleanPath, aiPath } = makePaths();
    const state = await readState();
    const pageSize = state.pageSize || 50;

    const candidates = await readJsonArray(precleanPath);
    let dashboardRows = await readJsonArray(dashboardPath);
    let aiRows = await readJsonArray(aiPath);

    if (candidates.length <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No pre-clean candidates found. Run Scan and Pre-clean first.",
          candidates: 0,
          reviewed: dashboardRows.length,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    let totalLeads = dashboardRows.length;
    let totalPages = Math.max(Math.ceil(totalLeads / pageSize), 1);
    let lastPreparedPage = Math.max(totalPages - 1, 0);

    const currentMaxUnlocked = Math.min(
      Math.max(state.maxUnlockedPage, 0),
      lastPreparedPage
    );

    let targetPage = totalLeads === 0 ? 0 : currentMaxUnlocked + 1;
    let reviewedMore = false;
    let logs = "";

    const needsNewLlmBatch = totalLeads === 0 || targetPage > lastPreparedPage;

    if (needsNewLlmBatch) {
      reviewedMore = true;

      const enrich = await runLocalScript("scripts/enrich-company-batch-ai.mjs", 25 * 60 * 1000);
      logs += "\n\n--- enrich-company-batch-ai.mjs ---\n" + enrich.stdout + "\n" + enrich.stderr;

      const build = await runLocalScript("scripts/build-company-dashboard-dataset.mjs", 10 * 60 * 1000);
      logs += "\n\n--- build-company-dashboard-dataset.mjs ---\n" + build.stdout + "\n" + build.stderr;

      // Important: do NOT blob-pull here. That can overwrite the newly-built local files.
      dashboardRows = await readJsonArray(dashboardPath);
      aiRows = await readJsonArray(aiPath);

      totalLeads = dashboardRows.length;
      totalPages = Math.max(Math.ceil(totalLeads / pageSize), 1);
      lastPreparedPage = Math.max(totalPages - 1, 0);

      if (totalLeads <= 0) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "LLM ran, but dashboard is still 0. Check AI key/model and qualification logs.",
            candidates: candidates.length,
            aiRows: aiRows.length,
            dashboardRows: totalLeads,
            logs: logs.slice(-5000),
          },
          { status: 500, headers: { "Cache-Control": "no-store" } }
        );
      }

      targetPage = Math.min(targetPage, lastPreparedPage);
    }

    const nextState = {
      // Keep user on the current page. Next 50 only unlocks/prepares the next page.
      // The right arrow then opens and moves the user to the prepared page.
      currentPage: Math.min(state.currentPage, Math.max(currentMaxUnlocked, targetPage)),
      maxUnlockedPage: Math.max(currentMaxUnlocked, targetPage),
      pageSize,
    };

    await writeState(nextState);

    if (process.env.VERCEL) {
      await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
    }

    const upcomingPage = nextState.maxUnlockedPage + 1;
    const hasPreparedNext = upcomingPage <= lastPreparedPage;
    const hasPendingCandidates = candidates.length > totalLeads;

    return NextResponse.json(
      {
        ok: true,
        reviewedMore,
        candidates: candidates.length,
        aiRows: aiRows.length,
        dashboardRows: totalLeads,
        currentPage: nextState.currentPage,
        maxUnlockedPage: nextState.maxUnlockedPage,
        totalPages,
        canGoPrev: nextState.currentPage > 0,
        canGoNext: nextState.currentPage < nextState.maxUnlockedPage,
        canUnlockNext: hasPreparedNext || hasPendingCandidates,
        nextStart: hasPreparedNext ? upcomingPage * pageSize + 1 : totalLeads + 1,
        nextEnd: hasPreparedNext
          ? Math.min((upcomingPage + 1) * pageSize, totalLeads)
          : Math.min(totalLeads + pageSize, candidates.length),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Reveal failed",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
