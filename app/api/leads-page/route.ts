import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";
import { runLocalScript } from "@/lib/run-local-script";

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

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
  }

  const { statePath } = makePaths();
  await mkdir(path.dirname(statePath), { recursive: true });

  const body = await request.json().catch(() => ({}));
  const direction = body.direction === "prev" ? "prev" : "next";

  const totalLeads = await readTotalLeads();
  const state = await readState();
  const totalPages = Math.max(Math.ceil(totalLeads / state.pageSize), 1);
  const maxUnlockedPage = Math.min(Math.max(state.maxUnlockedPage, 0), totalPages - 1);

  const currentPage = Math.min(Math.max(state.currentPage, 0), maxUnlockedPage);

  const nextPage =
    direction === "next"
      ? Math.min(currentPage + 1, maxUnlockedPage)
      : Math.max(currentPage - 1, 0);

  const nextState = {
    currentPage: nextPage,
    maxUnlockedPage,
    pageSize: state.pageSize,
  };

  await writeFile(statePath, JSON.stringify(nextState, null, 2));

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
  }

  return NextResponse.json(
    {
      ok: true,
      currentPage: nextPage,
      maxUnlockedPage,
      totalPages,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
