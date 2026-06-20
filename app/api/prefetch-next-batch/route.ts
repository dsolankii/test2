import { NextResponse } from "next/server";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { runLocalScript } from "@/lib/run-local-script";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function paths() {
  return {
    lockPath: dataPath(".ai-prefetch.lock"),
    logPath: dataPath("ai-prefetch-last.log"),
  };
}

async function exists(filePath: string) {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  applyWorkspaceToRequest(request);

  const { lockPath, logPath } = paths();
  await mkdir(path.dirname(lockPath), { recursive: true });

  if (await exists(lockPath)) {
    return NextResponse.json({
      ok: true,
      status: "already_running",
      message: "Next batch is already being prepared.",
    });
  }

  await writeFile(lockPath, new Date().toISOString());

  const logs: string[] = [];

  try {
    if (process.env.VERCEL) {
      await runLocalScript("scripts/blob-pull.mjs", 60 * 1000);
    }

    const preclean = await runLocalScript("scripts/preclean-real-sources.mjs", 10 * 60 * 1000);
    logs.push(preclean.stdout);

    const enrich = await runLocalScript("scripts/enrich-company-batch-ai.mjs", 25 * 60 * 1000);
    logs.push(enrich.stdout);

    const build = await runLocalScript("scripts/build-company-dashboard-dataset.mjs", 10 * 60 * 1000);
    logs.push(build.stdout);

    if (process.env.VERCEL) {
      await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
    }

    await writeFile(
      logPath,
      [
        `Prefetch finished ${new Date().toISOString()}`,
        ...logs,
      ].join("\n\n")
    );

    return NextResponse.json({
      ok: true,
      status: "completed",
      message: "Next reviewed lead batch is prepared.",
    });
  } catch (error) {
    await writeFile(
      logPath,
      `Prefetch failed ${new Date().toISOString()}\n${
        error instanceof Error ? error.message : String(error)
      }`
    );

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Prefetch failed",
      },
      { status: 500 }
    );
  } finally {
    await rm(lockPath, { force: true }).catch(() => {});
  }
}
