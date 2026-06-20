import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";
import { runLocalScript } from "@/lib/run-local-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE_SIZE = 50;

function makePaths() {
  return {
    precleanPath: dataPath("real-source-mentions-preclean.json"),
    aiPath: dataPath("ai-enriched-company-leads.json"),
    dashboardPath: dataPath("company-dashboard-leads.json"),
    statePath: dataPath("leadgrid-visible-state.json"),
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

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

export async function POST(request: Request) {
  applyWorkspaceToRequest(request);

  const { precleanPath, aiPath, dashboardPath, statePath } = makePaths();

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
  }

  const candidates = await readJsonArray(precleanPath);
  const beforeDashboardRows = await readJsonArray(dashboardPath);
  const beforeAiRows = await readJsonArray(aiPath);

  const beforeReviewed = beforeDashboardRows.length;

  const review = await runLocalScript(
    "scripts/review-next-company-batch.mjs",
    25 * 60 * 1000
  );

  const afterDashboardRows = await readJsonArray(dashboardPath);
  const afterAiRows = await readJsonArray(aiPath);

  const afterReviewed = afterDashboardRows.length;
  const addedReviewed = afterReviewed - beforeReviewed;

  if (addedReviewed <= 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "LLM review ran, but no new dashboard leads were added. Check review/build logs.",
        candidates: candidates.length,
        beforeReviewed,
        afterReviewed,
        beforeAiRows: beforeAiRows.length,
        afterAiRows: afterAiRows.length,
        logs: ["--- review-next-company-batch.mjs ---", review.stdout, review.stderr]
          .join("\n")
          .slice(-8000),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Strict target page:
  // 0 reviewed before -> page 0
  // 50 reviewed before -> page 1
  // 100 reviewed before -> page 2
  const currentPage = Math.max(Math.floor(beforeReviewed / PAGE_SIZE), 0);
  const maxUnlockedPage = Math.max(Math.ceil(afterReviewed / PAGE_SIZE) - 1, 0);

  await writeJson(statePath, {
    currentPage,
    maxUnlockedPage,
    pageSize: PAGE_SIZE,
  });

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
  }

  const pendingReview = Math.max(candidates.length - afterReviewed, 0);

  return NextResponse.json(
    {
      ok: true,
      candidates: candidates.length,
      beforeReviewed,
      afterReviewed,
      addedReviewed,
      beforeAiRows: beforeAiRows.length,
      afterAiRows: afterAiRows.length,
      currentPage,
      maxUnlockedPage,
      totalPages: Math.max(Math.ceil(afterReviewed / PAGE_SIZE), 1),
      canGoPrev: currentPage > 0,
      canGoNext: currentPage < maxUnlockedPage,
      canUnlockNext: pendingReview > 0,
      visibleStart: afterReviewed === 0 ? 0 : currentPage * PAGE_SIZE + 1,
      visibleEnd: Math.min((currentPage + 1) * PAGE_SIZE, afterReviewed),
      nextStart: pendingReview > 0 ? afterReviewed + 1 : 0,
      nextEnd:
        pendingReview > 0
          ? Math.min(afterReviewed + PAGE_SIZE, candidates.length)
          : 0,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
