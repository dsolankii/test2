import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { dataPath } from "@/lib/data-dir";
import { applyWorkspaceToRequest } from "@/lib/workspace";

function getStatePath() {
  return dataPath("leadgrid-visible-state.json");
}
function getLeadsPath() {
  return dataPath("company-dashboard-leads.json");
}

async function readTotalLeads() {
  try {
    const raw = await readFile(getLeadsPath(), "utf8");
    const leads = JSON.parse(raw);
    return Array.isArray(leads) ? leads.length : 0;
  } catch {
    return 0;
  }
}

async function readState() {
  try {
    const raw = await readFile(getStatePath(), "utf8");
    const state = JSON.parse(raw);

    return {
      currentPage: Number.isFinite(Number(state.currentPage)) ? Number(state.currentPage) : 0,
      maxUnlockedPage: Number.isFinite(Number(state.maxUnlockedPage)) ? Number(state.maxUnlockedPage) : 0,
      pageSize: Number.isFinite(Number(state.pageSize)) ? Number(state.pageSize) : 50,
    };
  } catch {
    return { currentPage: 0, maxUnlockedPage: 0, pageSize: 50 };
  }
}

export async function POST(request: Request) {
  applyWorkspaceToRequest(request);
  await mkdir(path.dirname(getStatePath()), { recursive: true });

  const body = await request.json().catch(() => ({}));
  const direction = body.direction === "prev" ? "prev" : "next";

  const totalLeads = await readTotalLeads();
  const state = await readState();
  const totalPages = Math.max(Math.ceil(totalLeads / state.pageSize), 1);
  const maxUnlockedPage = Math.min(state.maxUnlockedPage, totalPages - 1);

  const nextPage =
    direction === "next"
      ? Math.min(state.currentPage + 1, maxUnlockedPage)
      : Math.max(state.currentPage - 1, 0);

  const nextState = {
    currentPage: nextPage,
    maxUnlockedPage,
    pageSize: state.pageSize,
  };

  await writeFile(getStatePath(), JSON.stringify(nextState, null, 2));

  return NextResponse.json({
    ok: true,
    currentPage: nextPage,
    maxUnlockedPage,
    totalPages,
  });
}
