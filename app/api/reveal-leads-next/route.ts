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

async function prepareNextStrictLlmBatch() {
  const preclean = await runLocalScript("scripts/preclean-real-sources.mjs", 10 * 60 * 1000);
  const enrich = await runLocalScript("scripts/enrich-company-batch-ai.mjs", 25 * 60 * 1000);
  const build = await runLocalScript("scripts/build-company-dashboard-dataset.mjs", 10 * 60 * 1000);

  return {
    preclean: preclean.stdout,
    enrich: enrich.stdout,
    build: build.stdout,
  };
}

export async function POST(request: Request) {
  applyWorkspaceToRequest(request);

  try {
    if (process.env.VERCEL) {
      await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
    }

    const { statePath } = makePaths();
    await mkdir(path.dirname(statePath), { recursive: true });

    const state = await readState();
    const currentTotal = await readTotalLeads();
    const currentLastPreparedPage = Math.max(
      Math.ceil(currentTotal / state.pageSize) - 1,
      0
    );

    const currentMaxUnlocked = Math.min(
      Math.max(state.maxUnlockedPage, 0),
      currentLastPreparedPage
    );

    const nextPage = currentMaxUnlocked + 1;
    let totalLeads = currentTotal;
    let lastPreparedPage = currentLastPreparedPage;
    let reviewedMore = false;

    if (nextPage > lastPreparedPage) {
      reviewedMore = true;
      await prepareNextStrictLlmBatch();

      if (process.env.VERCEL) {
        await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
      }

      totalLeads = await readTotalLeads();
      lastPreparedPage = Math.max(Math.ceil(totalLeads / state.pageSize) - 1, 0);
    }

    if (nextPage > lastPreparedPage) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "LLM review finished but no new reviewed leads were produced. Check Review/Qualification logs.",
          totalLeads,
          currentPage: Math.min(state.currentPage, currentMaxUnlocked),
          maxUnlockedPage: currentMaxUnlocked,
          reviewedMore,
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

    const totalPages = Math.max(Math.ceil(totalLeads / state.pageSize), 1);
    const upcomingPage = Math.min(nextPage + 1, lastPreparedPage);
    const hasNextPrepared = nextPage < lastPreparedPage;

    return NextResponse.json(
      {
        ok: true,
        currentPage: nextPage,
        maxUnlockedPage: nextPage,
        totalPages,
        reviewedMore,
        canUnlockNext: hasNextPrepared,
        nextStart: hasNextPrepared ? upcomingPage * state.pageSize + 1 : totalLeads + 1,
        nextEnd: hasNextPrepared
          ? Math.min((upcomingPage + 1) * state.pageSize, totalLeads)
          : totalLeads + state.pageSize,
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
