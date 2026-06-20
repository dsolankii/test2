import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { runLocalScript } from "@/lib/run-local-script";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStatePath() {
  return dataPath("leadgrid-visible-state.json");
}
function getLeadsPath() {
  return dataPath("company-dashboard-leads.json");
}

async function readTotalLeads() {
  try {
    const raw = await readFile(getLeadsPath(), "utf8");
    const leads = JSON.parse(raw);
    return Array.isArray(leads) ? leads.length : 0;
  } catch {
    return 0;
  }
}

async function readState() {
  try {
    const raw = await readFile(getStatePath(), "utf8");
    const state = JSON.parse(raw);

    return {
      currentPage: Number.isFinite(Number(state.currentPage)) ? Number(state.currentPage) : 0,
      maxUnlockedPage: Number.isFinite(Number(state.maxUnlockedPage)) ? Number(state.maxUnlockedPage) : 0,
      pageSize: Number.isFinite(Number(state.pageSize)) ? Number(state.pageSize) : 50,
    };
  } catch {
    return { currentPage: 0, maxUnlockedPage: 0, pageSize: 50 };
  }
}

export async function POST(request: Request) {
  applyWorkspaceToRequest(request);
  try {
    await mkdir(path.dirname(getStatePath()), { recursive: true });

    const beforeTotal = await readTotalLeads();
    const beforeState = await readState();
    const beforePages = Math.max(Math.ceil(beforeTotal / beforeState.pageSize), 1);

    const needsMoreRows =
      beforeState.maxUnlockedPage >= beforePages - 2;

    if (needsMoreRows) {
      await runLocalScript("scripts/enrich-company-batch-ai.mjs", 25 * 60 * 1000);
      await runLocalScript("scripts/build-company-dashboard-dataset.mjs", 10 * 60 * 1000);
    }

    const totalLeads = await readTotalLeads();
    const state = await readState();
    const totalPages = Math.max(Math.ceil(totalLeads / state.pageSize), 1);

    const nextUnlockedPage = Math.min(state.maxUnlockedPage + 1, totalPages - 1);

    const nextState = {
      currentPage: nextUnlockedPage,
      maxUnlockedPage: nextUnlockedPage,
      pageSize: state.pageSize,
    };

    await writeFile(getStatePath(), JSON.stringify(nextState, null, 2));

    const nextPipelinePage = Math.min(nextUnlockedPage + 1, totalPages - 1);
    const hasNext = nextUnlockedPage < totalPages - 1;

    if (process.env.VERCEL) await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
  return NextResponse.json(
      {
        ok: true,
        currentPage: nextUnlockedPage,
        maxUnlockedPage: nextUnlockedPage,
        totalPages,
        reviewedMore: needsMoreRows,
        canUnlockNext: hasNext,
        nextStart: hasNext ? nextPipelinePage * state.pageSize + 1 : 0,
        nextEnd: hasNext ? Math.min((nextPipelinePage + 1) * state.pageSize, totalLeads) : 0,
      },
      {
        headers: { "Cache-Control": "no-store" },
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
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
