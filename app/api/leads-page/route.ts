import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";
import { runLocalScript } from "@/lib/run-local-script";

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

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
  }

  const body = await request.json().catch(() => ({}));
  const direction = body.direction === "prev" ? "prev" : "next";

  const { dashboardPath } = makePaths();
  const dashboardRows = await readJsonArray(dashboardPath);
  const state = await readState();

  const pageSize = state.pageSize || 50;
  const totalAvailable = dashboardRows.length;
  const totalPages = Math.max(Math.ceil(totalAvailable / pageSize), 1);
  const maxUnlockedPage = Math.min(
    Math.max(state.maxUnlockedPage, 0),
    totalPages - 1
  );

  const currentPage = Math.min(
    Math.max(state.currentPage, 0),
    maxUnlockedPage
  );

  const nextPage =
    direction === "next"
      ? Math.min(currentPage + 1, maxUnlockedPage)
      : Math.max(currentPage - 1, 0);

  const nextState = {
    currentPage: nextPage,
    maxUnlockedPage,
    pageSize,
  };

  await writeState(nextState);

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
  }

  return NextResponse.json(
    {
      ok: true,
      currentPage: nextPage,
      maxUnlockedPage,
      totalPages,
      totalAvailable,
      visibleStart: totalAvailable === 0 ? 0 : nextPage * pageSize + 1,
      visibleEnd: Math.min((nextPage + 1) * pageSize, totalAvailable),
      canGoPrev: nextPage > 0,
      canGoNext: nextPage < maxUnlockedPage,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
