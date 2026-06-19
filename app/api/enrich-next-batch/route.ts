import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import { LEADGRID_DATA_DIR, dataPath } from "@/lib/data-dir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();
const LOCK_FILE = dataPath(".ai-enrichment.lock");

const PRECLEAN_JSON = dataPath("real-source-mentions-preclean.json");
const AI_COMPANY_JSON = dataPath("ai-enriched-company-leads.json");
const VISIBLE_STATE_JSON = dataPath("ai-visible-state.json");

const BATCH_SIZE = 50;

type AnyRow = Record<string, any>;

function readJson(filePath: string, fallback: any = []) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath: string, value: any) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function cleanText(value = "") {
  return String(value)
    .replace(/[�]/g, "")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompanyName(name = "") {
  return cleanText(name)
    .toLowerCase()
    .replace(/\b(inc|inc\.|llc|ltd|ltd\.|corp|corp\.|corporation|company|co|co\.|limited|plc|gmbh|sa|ag)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyKeyFromName(name = "") {
  return normalizeCompanyName(name) || cleanText(name).toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function uniqueCompanyCount(rows: AnyRow[]) {
  const keys = new Set<string>();

  for (const row of rows) {
    const key = row.companyKey || companyKeyFromName(row.rawName || "");
    if (key) keys.add(key);
  }

  return keys.size;
}

async function runNodeScript(scriptPath: string) {
  const result = await execFileAsync(process.execPath, [scriptPath], {
    cwd: ROOT,
    timeout: 1000 * 60 * 8,
    maxBuffer: 1024 * 1024 * 20,
    env: { ...process.env, LEADGRID_DATA_DIR },
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function getProgress() {
  const precleanRows = readJson(PRECLEAN_JSON);
  const aiRows = readJson(AI_COMPANY_JSON);
  const state = readJson(VISIBLE_STATE_JSON, { visibleAiCount: aiRows.length, batchSize: BATCH_SIZE });

  const totalAcceptedCompanies = uniqueCompanyCount(precleanRows);
  const prefetchedAiCompanies = uniqueCompanyCount(aiRows);
  const visibleAiCompanies = Math.min(Number(state.visibleAiCount || 0), prefetchedAiCompanies);

  return {
    totalAcceptedCompanies,
    visibleAiCompanies,
    prefetchedAiCompanies,
    pendingAiCompanies: Math.max(0, totalAcceptedCompanies - prefetchedAiCompanies),
    readyToRevealCount: Math.max(0, prefetchedAiCompanies - visibleAiCompanies),
    isComplete: visibleAiCompanies >= totalAcceptedCompanies,
  };
}

function revealNextBatch() {
  const aiRows = readJson(AI_COMPANY_JSON);
  const state = readJson(VISIBLE_STATE_JSON, { visibleAiCount: 0, batchSize: BATCH_SIZE });

  const currentVisible = Math.min(Number(state.visibleAiCount || 0), aiRows.length);
  const nextVisible = Math.min(aiRows.length, currentVisible + BATCH_SIZE);

  writeJson(VISIBLE_STATE_JSON, {
    ...state,
    visibleAiCount: nextVisible,
    batchSize: BATCH_SIZE,
    lastRevealedAt: new Date().toISOString(),
  });

  return {
    currentVisible,
    nextVisible,
    revealed: Math.max(0, nextVisible - currentVisible),
  };
}

export async function POST() {
  let lockHandle: number | null = null;

  try {
    fs.mkdirSync(LEADGRID_DATA_DIR, { recursive: true });

    if (fs.existsSync(LOCK_FILE)) {
      return NextResponse.json(
        {
          ok: false,
          error: "AI pipeline is already running. Wait for it to finish.",
        },
        { status: 409 }
      );
    }

    lockHandle = fs.openSync(LOCK_FILE, "wx");
    fs.writeFileSync(LOCK_FILE, new Date().toISOString());

    const precleanResult = await runNodeScript("scripts/preclean-real-sources.mjs");
    const before = getProgress();

    if (before.isComplete) {
      await runNodeScript("scripts/build-company-dashboard-dataset.mjs");

      return NextResponse.json({
        ok: true,
        mode: "complete",
        message: "All companies are already Gemini-reviewed and visible.",
        before,
        after: before,
        logs: {
          preclean: precleanResult.stdout,
        },
      });
    }

    let enrichResult = { stdout: "", stderr: "" };
    let mode = "reveal_prefetched";

    if (before.readyToRevealCount <= 0) {
      mode = "enrich_then_reveal";
      enrichResult = await runNodeScript("scripts/enrich-company-batch-ai.mjs");
    }

    const reveal = revealNextBatch();
    const buildResult = await runNodeScript("scripts/build-company-dashboard-dataset.mjs");

    const after = getProgress();

    return NextResponse.json({
      ok: true,
      mode,
      message:
        mode === "reveal_prefetched"
          ? `Revealed ${reveal.revealed} already prepared Gemini-reviewed companies.`
          : `Ran full pipeline and revealed ${reveal.revealed} new Gemini-reviewed companies.`,
      batchStart: before.visibleAiCompanies + 1,
      batchEnd: after.visibleAiCompanies,
      newCompaniesVisible: reveal.revealed,
      before,
      after,
      logs: {
        preclean: precleanResult.stdout,
        enrich: enrichResult.stdout,
        build: buildResult.stdout,
        errors: [precleanResult.stderr, enrichResult.stderr, buildResult.stderr].filter(Boolean).join("\n"),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || String(error),
        stdout: error?.stdout || "",
        stderr: error?.stderr || "",
      },
      { status: 500 }
    );
  } finally {
    if (lockHandle !== null) {
      try {
        fs.closeSync(lockHandle);
      } catch {}
    }

    try {
      if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
    } catch {}
  }
}
