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
  const { dashboardPath } = makePaths();
  return (await readJsonArray(dashboardPath)).length;
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

    const totalLeads = await readTotalLeads();
    const state = await readState();
    const totalPages = Math.max(Math.ceil(totalLeads / state.pageSize), 1);
    const lastPreparedPage = Math.max(totalPages - 1, 0);

    const nextPage = state.maxUnlockedPage + 1;

    if (nextPage > lastPreparedPage) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Next 50 is not prepared yet. Wait for background LLM review to finish, or run Review from Console.",
          totalLeads,
          totalPages,
          currentPage: state.currentPage,
          maxUnlockedPage: state.maxUnlockedPage,
        },
        {
          status: 409,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const nextState = {
      currentPage: nextPage,
      maxUnlockedPage: nextPage,
      pageSize: state.pageSize,
    };

    await writeFile(statePath, JSON.stringify(nextState, null, 2));

    if (process.env.VERCEL) {
      await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
    }

    const upcomingPage = Math.min(nextPage + 1, lastPreparedPage);
    const hasNext = nextPage < lastPreparedPage;

    return NextResponse.json(
      {
        ok: true,
        currentPage: nextPage,
        maxUnlockedPage: nextPage,
        totalPages,
        reviewedMore: false,
        canUnlockNext: hasNext,
        nextStart: hasNext ? upcomingPage * state.pageSize + 1 : 0,
        nextEnd: hasNext
          ? Math.min((upcomingPage + 1) * state.pageSize, totalLeads)
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
