import { access, mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { get, list, put } from "@vercel/blob";
import { LEADGRID_DATA_DIR } from "@/lib/data-dir";

const PREFIX = process.env.LEADGRID_BLOB_PREFIX || "leadgrid/data";

const FILES = [
  "current-live-run.json",
  "real-source-mentions.json",
  "real-source-mentions.csv",
  "real-source-mentions-preclean.json",
  "real-source-mentions-rejected-preclean.json",
  "ai-enriched-company-leads.json",
  "ai-enriched-company-leads.csv",
  "company-dashboard-leads.json",
  "company-dashboard-leads.csv",
  "raw-company-mentions.json",
  "leadgrid-visible-state.json",
  "saas-conference-source-pages.json",
  "open-lead-rss-sources.json"
];

function blobAccess(): "private" | "public" {
  return process.env.LEADGRID_BLOB_ACCESS === "public" ? "public" : "private";
}

function blobPath(file: string) {
  return `${PREFIX}/${file}`;
}

function localPath(file: string) {
  return path.join(LEADGRID_DATA_DIR, file);
}

function contentType(file: string) {
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".csv")) return "text/csv";
  return "text/plain";
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPrivateBlob(pathname: string) {
  const result: any = await get(pathname, { access: "private" });

  if (!result || result.statusCode !== 200 || !result.stream) {
    return null;
  }

  return await new Response(result.stream).text();
}

async function readPublicBlob(url: string) {
  const response = await fetch(`${url}?v=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) return null;
  return await response.text();
}

export async function pullBlobData() {
  await mkdir(LEADGRID_DATA_DIR, { recursive: true });

  const accessMode = blobAccess();
  const { blobs } = await list({
    prefix: `${PREFIX}/`,
    limit: 1000
  });

  const byPath = new Map(blobs.map((blob) => [blob.pathname, blob]));
  let pulled = 0;

  for (const file of FILES) {
    const pathname = blobPath(file);
    const blob = byPath.get(pathname);
    if (!blob) continue;

    const body =
      accessMode === "private"
        ? await readPrivateBlob(pathname)
        : await readPublicBlob(blob.url);

    if (body == null) continue;

    await writeFile(localPath(file), body);
    pulled += 1;
  }

  console.log(`Blob pull complete: ${pulled} files`);
}

export async function pushBlobData() {
  await mkdir(LEADGRID_DATA_DIR, { recursive: true });

  const accessMode = blobAccess();
  let pushed = 0;

  for (const file of FILES) {
    const filePath = localPath(file);
    if (!(await exists(filePath))) continue;

    const body = await readFile(filePath);

    await put(blobPath(file), body, {
      access: accessMode,
      allowOverwrite: true,
      contentType: contentType(file),
      cacheControlMaxAge: 0
    });

    pushed += 1;
  }

  console.log(`Blob push complete: ${pushed} files`);
}
