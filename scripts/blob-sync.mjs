import { readFile, writeFile, mkdir, access } from "fs/promises";
import path from "path";
import { list, put } from "@vercel/blob";
import { DATA_DIR } from "./data-dir.mjs";

const mode = process.argv[2];

if (!["pull", "push"].includes(mode)) {
  console.error("Usage: node scripts/blob-sync.mjs pull|push");
  process.exit(1);
}

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

function blobPath(file) {
  return `${PREFIX}/${file}`;
}

function contentType(file) {
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".csv")) return "text/csv";
  return "text/plain";
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pull() {
  await mkdir(DATA_DIR, { recursive: true });

  const { blobs } = await list({
    prefix: `${PREFIX}/`,
    limit: 1000
  });

  const byPath = new Map(blobs.map((blob) => [blob.pathname, blob]));
  let pulled = 0;

  for (const file of FILES) {
    const blob = byPath.get(blobPath(file));
    if (!blob?.url) continue;

    const response = await fetch(`${blob.url}?v=${Date.now()}`, {
      cache: "no-store"
    });

    if (!response.ok) continue;

    const body = await response.text();
    await writeFile(path.join(DATA_DIR, file), body);
    pulled += 1;
  }

  console.log(`Blob pull complete: ${pulled} files`);
}

async function push() {
  await mkdir(DATA_DIR, { recursive: true });

  let pushed = 0;

  for (const file of FILES) {
    const filePath = path.join(DATA_DIR, file);

    if (!(await exists(filePath))) continue;

    const body = await readFile(filePath);

    await put(blobPath(file), body, {
      access: "public",
      allowOverwrite: true,
      contentType: contentType(file),
      cacheControlMaxAge: 0
    });

    pushed += 1;
  }

  console.log(`Blob push complete: ${pushed} files`);
}

if (mode === "pull") {
  await pull();
} else {
  await push();
}
