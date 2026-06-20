import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";
import { runLocalScript } from "@/lib/run-local-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function readJsonArray(filePath: string) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readJsonObject(filePath: string) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function fileExists(filePath: string) {
  try {
    const info = await stat(filePath);
    return {
      exists: true,
      bytes: info.size,
      updatedAt: info.mtime.toISOString(),
    };
  } catch {
    return {
      exists: false,
      bytes: 0,
      updatedAt: null,
    };
  }
}

export async function GET(request: Request) {
  applyWorkspaceToRequest(request);

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
  }

  const dashboardPath = dataPath("company-dashboard-leads.json");
  const precleanPath = dataPath("real-source-mentions-preclean.json");
  const statePath = dataPath("leadgrid-visible-state.json");
  const lockPath = dataPath(".ai-prefetch.lock");
  const logPath = dataPath("ai-prefetch-last.log");

  const dashboardRows = await readJsonArray(dashboardPath);
  const precleanRows = await readJsonArray(precleanPath);
  const state = await readJsonObject(statePath);
  const lock = await fileExists(lockPath);
  const log = await fileExists(logPath);

  let lastLog = "";
  try {
    lastLog = (await readFile(logPath, "utf8")).slice(-2000);
  } catch {}

  const pageSize = Number(state.pageSize || 50);
  const currentPage = Number(state.currentPage || 0);
  const maxUnlockedPage = Number(state.maxUnlockedPage || 0);
  const reviewed = dashboardRows.length;
  const candidates = precleanRows.length;
  const pending = Math.max(candidates - reviewed, 0);

  return NextResponse.json(
    {
      ok: true,
      reviewed,
      candidates,
      pending,
      pageSize,
      currentPage,
      maxUnlockedPage,
      currentRange: {
        start: reviewed === 0 ? 0 : currentPage * pageSize + 1,
        end: Math.min((currentPage + 1) * pageSize, reviewed),
      },
      unlockedRange: {
        start: 1,
        end: Math.min((maxUnlockedPage + 1) * pageSize, reviewed),
      },
      canGoBack: currentPage > 0,
      canGoForward: currentPage < maxUnlockedPage,
      backgroundReviewRunning: lock.exists,
      lastPrefetchLog: log,
      lastLog,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
