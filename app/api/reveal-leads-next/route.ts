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
    const beforeDashboardRows = await readJsonArray(dashboardPath);
    const beforeAiRows = await readJsonArray(aiPath);

    if (candidates.length <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No pre-clean candidates found. Run Scan and Pre-clean first.",
          candidates: 0,
          reviewed: beforeDashboardRows.length,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    const beforeReviewed = beforeDashboardRows.length;

    const review = await runLocalScript("scripts/review-next-company-batch.mjs", 25 * 60 * 1000);

    // Important: do not blob-pull after building. That can overwrite the new local dashboard.
    const afterDashboardRows = await readJsonArray(dashboardPath);
    const afterAiRows = await readJsonArray(aiPath);
    const afterReviewed = afterDashboardRows.length;

    if (afterReviewed <= beforeReviewed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "LLM review ran, but no new reviewed leads were added. Check AI key/model and qualification logs.",
          candidates: candidates.length,
          beforeReviewed,
          afterReviewed,
          beforeAiRows: beforeAiRows.length,
          afterAiRows: afterAiRows.length,
          logs: [
            "--- review-next-company-batch.mjs ---",
            review.stdout,
            review.stderr,
          ]
            .join("\n")
            .slice(-5000),
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const targetPage = Math.floor(beforeReviewed / pageSize);
    const totalPages = Math.max(Math.ceil(afterReviewed / pageSize), 1);
    const lastPreparedPage = Math.max(totalPages - 1, 0);
    const safeTargetPage = Math.min(targetPage, lastPreparedPage);

    const nextState = {
      currentPage: safeTargetPage,
      maxUnlockedPage: Math.max(state.maxUnlockedPage, safeTargetPage),
      pageSize,
    };

    await writeState(nextState);

    if (process.env.VERCEL) {
      await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
    }

    const upcomingPage = nextState.maxUnlockedPage + 1;
    const hasPendingCandidates = candidates.length > afterReviewed;

    return NextResponse.json(
      {
        ok: true,
        candidates: candidates.length,
        beforeReviewed,
        afterReviewed,
        addedReviewed: afterReviewed - beforeReviewed,
        currentPage: nextState.currentPage,
        maxUnlockedPage: nextState.maxUnlockedPage,
        totalPages,
        canGoPrev: nextState.currentPage > 0,
        canGoNext: nextState.currentPage < nextState.maxUnlockedPage,
        canUnlockNext: hasPendingCandidates,
        visibleStart: safeTargetPage * pageSize + 1,
        visibleEnd: Math.min((safeTargetPage + 1) * pageSize, afterReviewed),
        nextStart: hasPendingCandidates ? afterReviewed + 1 : 0,
        nextEnd: hasPendingCandidates
          ? Math.min(afterReviewed + pageSize, candidates.length)
          : 0,
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
