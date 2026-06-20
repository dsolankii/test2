import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { runLocalScript } from "@/lib/run-local-script";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function makePaths() {
  return {
    statePath: dataPath("leadgrid-visible-state.json"),
    dashboardPath: dataPath("company-dashboard-leads.json"),
    enrichedPath: dataPath("ai-enriched-company-leads.json"),
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

async function readTotalLeads() {
  const { dashboardPath, enrichedPath } = makePaths();
  const dashboardRows = await readJsonArray(dashboardPath);
  if (dashboardRows.length > 0) return dashboardRows.length;
  return (await readJsonArray(enrichedPath)).length;
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

export async function POST(request: Request) {
  applyWorkspaceToRequest(request);

  try {
    if (process.env.VERCEL) {
      await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
    }

    const { statePath } = makePaths();
    await mkdir(path.dirname(statePath), { recursive: true });

    const beforeTotal = await readTotalLeads();
    const beforeState = await readState();
    const beforePages = Math.max(Math.ceil(beforeTotal / beforeState.pageSize), 1);

    const alreadyNearEnd = beforeState.maxUnlockedPage >= beforePages - 2;
    const hasNoRowsYet = beforeTotal === 0;
    const shouldReviewMore = hasNoRowsYet || alreadyNearEnd;

    if (shouldReviewMore) {
      await runLocalScript("scripts/enrich-company-batch-ai.mjs", 25 * 60 * 1000);
      await runLocalScript("scripts/build-company-dashboard-dataset.mjs", 10 * 60 * 1000);
    }

    const totalLeads = await readTotalLeads();
    const state = await readState();
    const totalPages = Math.max(Math.ceil(totalLeads / state.pageSize), 1);

    const nextUnlockedPage = Math.min(
      Math.max(state.maxUnlockedPage + 1, 0),
      totalPages - 1
    );

    const nextState = {
      currentPage: nextUnlockedPage,
      maxUnlockedPage: nextUnlockedPage,
      pageSize: state.pageSize,
    };

    await writeFile(statePath, JSON.stringify(nextState, null, 2));

    if (process.env.VERCEL) {
      await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
    }

    const nextPipelinePage = Math.min(nextUnlockedPage + 1, totalPages - 1);
    const hasNext = nextUnlockedPage < totalPages - 1;

    return NextResponse.json(
      {
        ok: true,
        currentPage: nextUnlockedPage,
        maxUnlockedPage: nextUnlockedPage,
        totalPages,
        reviewedMore: shouldReviewMore,
        canUnlockNext: hasNext,
        nextStart: hasNext ? nextPipelinePage * state.pageSize + 1 : 0,
        nextEnd: hasNext
          ? Math.min((nextPipelinePage + 1) * state.pageSize, totalLeads)
          : 0,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Next page failed",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
