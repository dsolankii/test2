import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";
import { runLocalScript } from "@/lib/run-local-script";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  applyWorkspaceToRequest(request);

  const statePath = dataPath("leadgrid-visible-state.json");
  await mkdir(path.dirname(statePath), { recursive: true });

  const state = {
    currentPage: 0,
    maxUnlockedPage: 0,
    pageSize: 50,
  };

  await writeFile(statePath, JSON.stringify(state, null, 2));

  if (process.env.VERCEL) {
    await runLocalScript("scripts/blob-push.mjs", 60 * 1000);
  }

  return NextResponse.json(
    {
      ok: true,
      state,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
