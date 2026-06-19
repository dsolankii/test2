import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const ROOT = process.cwd();
const CONFIG_PATH = dataPath("saas-conference-source-pages.json");
const OUT_JSON = dataPath("real-source-mentions.json");
const OUT_CSV = dataPath("real-source-mentions.csv");

const OBVIOUS_BAD_EXACT = new Set([
  "home",
  "login",
  "register",
  "tickets",
  "agenda",
  "contact",
  "contact us",
  "book tickets",
  "buy tickets",
  "view agenda",
  "search",
  "menu",
  "open",
  "close",
  "next",
  "previous",
  "back",
  "share",
  "download",
  "privacy",
  "privacy policy",
  "terms",
  "terms of service",
  "cookie",
  "cookies",
  "newsletter",
  "subscribe",
  "header",
  "footer",
  "footer logo",
  "json",
  "rsd",
  "scroll to top",
  "download on the app store",
  "download on google play",
  "feast your mind",
  "global village",
  "interact",
  "dublin tech summit",
  "copyright and company info",
  "click to start search"
]);

const OBVIOUS_BAD_CONTAINS = [
  "powered by",
  "all rights reserved",
  "early-table",
  "cookie policy",
  "feature sessions",
  "dts partners - currently trusted",
  "icon:",
  "currently trusted by_",
  "sustainability policy"
];

function normalize(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCompanyName(row) {
  return normalize(
    row.companyName ||
      row.company ||
      row.name ||
      row.organization ||
      row.organisation ||
      row.employer ||
      ""
  );
}

function getSourceName(row) {
  return normalize(row.sourceName || row.source || row.sourceType || "Public source");
}

function isObviousJunk(value) {
  const name = normalize(value);
  const lower = name.toLowerCase();

  if (!name) return true;
  if (name.length < 2 || name.length > 120) return true;
  if (OBVIOUS_BAD_EXACT.has(lower)) return true;
  if (OBVIOUS_BAD_CONTAINS.some((phrase) => lower.includes(phrase))) return true;

  if (/^https?:\/\//i.test(name)) return true;
  if (/^\d+$/.test(name)) return true;
  if (/[{}[\]|<>]/.test(name)) return true;
  if (/\.(png|jpg|jpeg|svg|gif|webp|css|js|ico)$/i.test(name)) return true;
  if (/-\d+x\d+$/i.test(name)) return true;
  if (/\b\d+x\d+\b/i.test(name)) return true;

  return false;
}

function extractCandidates(html) {
  const candidates = new Set();

  const patterns = [
    /<a\b[^>]*>(.*?)<\/a>/gis,
    /alt=["']([^"']+)["']/gis,
    /title=["']([^"']+)["']/gis,
    /aria-label=["']([^"']+)["']/gis,
    /"name"\s*:\s*"([^"]+)"/gis,
    /"company"\s*:\s*"([^"]+)"/gis,
    /"organization"\s*:\s*"([^"]+)"/gis
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(html))) {
      const cleaned = normalize(match[1]);
      if (!isObviousJunk(cleaned)) {
        candidates.add(cleaned);
      }
    }
  }

  return [...candidates];
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  const headers = [
    "companyName",
    "sourceName",
    "source",
    "sourceType",
    "sourceUrl",
    "signal",
    "mentionTitle",
    "capturedAt"
  ];

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ].join("\n");
}

async function readJsonArray(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; LeadGridSignalBot/1.0)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${url}`);
  }

  return response.text();
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const sources = await readJsonArray(CONFIG_PATH);
  const existingRows = await readJsonArray(OUT_JSON);
  const capturedAt = new Date().toISOString();

  const managedSourceNames = new Set(sources.map((source) => source.name));

  // Preserve existing non-event rows.
  const keptExistingRows = existingRows.filter((row) => {
    const sourceName = getSourceName(row);
    return !managedSourceNames.has(sourceName);
  });

  const newRows = [];

  for (const source of sources) {
    console.log(`Scanning SaaS/event source: ${source.name}`);

    try {
      const html = await fetchHtml(source.url);
      const candidates = extractCandidates(html);

      console.log(`  found ${candidates.length} candidates`);

      for (const companyName of candidates) {
        newRows.push({
          companyName,
          sourceName: source.name,
          source: source.name,
          sourceType: source.type || "event",
          sourceUrl: source.url,
          signal: "Public event activity",
          mentionTitle: `${companyName} appeared on ${source.name}`,
          capturedAt
        });
      }
    } catch (error) {
      console.log(`  failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  const seen = new Set();
  const mergedRows = [];

  for (const row of [...keptExistingRows, ...newRows]) {
    const companyName = getCompanyName(row);
    const sourceName = getSourceName(row);

    if (isObviousJunk(companyName)) continue;

    const key = `${companyName.toLowerCase()}::${sourceName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    mergedRows.push({
      ...row,
      companyName,
      sourceName,
      source: row.source || sourceName
    });
  }

  if (existingRows.length >= 100 && mergedRows.length < 100) {
    console.error("SaaS extraction safety stop");
    console.error(`Before: ${existingRows.length}`);
    console.error(`After: ${mergedRows.length}`);
    console.error("Refusing to write because merge would remove too much.");
    process.exit(1);
  }

  console.log("");
  console.log(`Existing kept rows: ${keptExistingRows.length}`);
  console.log(`New SaaS/event candidates: ${newRows.length}`);
  console.log(`Merged rows: ${mergedRows.length}`);

  await writeFile(OUT_JSON, JSON.stringify(mergedRows, null, 2));
  await writeFile(OUT_CSV, toCsv(mergedRows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
