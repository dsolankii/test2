import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { LEADGRID_DATA_DIR, dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.cwd();
const LOCK_FILE = dataPath(".ai-prefetch.lock");
const LOG_FILE = dataPath("ai-prefetch-last.log");

function runDetachedPipeline() {
  const command = [
    "node scripts/preclean-real-sources.mjs",
    "node scripts/enrich-company-batch-ai.mjs",
    "node scripts/build-company-dashboard-dataset.mjs",
  ].join(" && ");

  const child = spawn("bash", ["-lc", command], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LEADGRID_DATA_DIR },
  });

  const log = fs.createWriteStream(LOG_FILE, { flags: "a" });

  log.write(`\n\n--- Prefetch started ${new Date().toISOString()} ---\n`);

  child.stdout.pipe(log);
  child.stderr.pipe(log);

  child.on("close", (code) => {
    log.write(`\n--- Prefetch finished ${new Date().toISOString()} with code ${code} ---\n`);
    log.end();

    try {
      if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
    } catch {}
  });

  child.unref();
}

export async function POST(request: Request) {
  applyWorkspaceToRequest(request);
  try {
    fs.mkdirSync(LEADGRID_DATA_DIR, { recursive: true });

    if (fs.existsSync(LOCK_FILE)) {
      return NextResponse.json({
        ok: true,
        status: "already_running",
        message: "Next batch prefetch is already running.",
      });
    }

    fs.writeFileSync(LOCK_FILE, new Date().toISOString());
    runDetachedPipeline();

    return NextResponse.json({
      ok: true,
      status: "started",
      message: "Started background preparation for the next 50 Gemini-reviewed companies.",
    });
  } catch (error) {
    try {
      if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
    } catch {}

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
