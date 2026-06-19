import { readFile, writeFile, mkdir } from "fs/promises";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const CONFIG_PATH = dataPath("saas-conference-source-pages.json");
const OUT_JSON = dataPath("real-source-mentions.json");
const OUT_CSV = dataPath("real-source-mentions.csv");

const FETCH_TIMEOUT_MS = Number(process.env.SAAS_EVENT_FETCH_TIMEOUT_MS || 25000);
const MAX_EVENT_SOURCES = Number(process.env.MAX_EVENT_SOURCES || 10);
const MAX_EVENT_CANDIDATES_PER_SOURCE = Number(
  process.env.MAX_EVENT_CANDIDATES_PER_SOURCE || 250
);

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
  "download on google play"
]);

const OBVIOUS_BAD_CONTAINS = [
  "powered by",
  "all rights reserved",
  "cookie policy",
  "feature sessions",
  "icon:"
];

function parseEnvSources() {
  const raw = process.env.SAAS_EVENT_SOURCES_JSON || "";
  if (!raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.log(
      `SAAS_EVENT_SOURCES_JSON parse failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
    return [];
  }
}

function normalize(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCompanyName(row) {
  return normalize(
    row.rawName ||
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
    /<a[^>]*>([\s\S]*?)<\/a>/gis,
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

  return [...candidates].slice(0, MAX_EVENT_CANDIDATES_PER_SOURCE);
}

function csvEscape(value) {
  if (value === undefined || value === null) return "";
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  const cleaned = text.replace(/\r?\n|\r/g, " ").replace(/\s+/g, " ").trim();
  return `"${cleaned.replace(/"/g, '""')}"`;
}

function toPipelineCsv(rows) {
  const headers = [
    "id",
    "rawName",
    "website",
    "sourceType",
    "sourceName",
    "sourceUrl",
    "description",
    "homepageText",
    "careersText",
    "lastActivityDate",
    "country",
    "estimatedSize",
    "stageHint",
    "agentConfidence",
    "expectedCategory",
    "expectedTrashReason"
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LeadGridSignalBot/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      throw new Error(`Fetch failed ${response.status}: ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadSources() {
  const fileSources = await readJsonArray(CONFIG_PATH);
  const envSources = parseEnvSources();
  const sources = fileSources.length > 0 ? fileSources : envSources;

  return sources
    .filter((source) => source && source.name && source.url)
    .slice(0, MAX_EVENT_SOURCES);
}

function toPipelineRow(companyName, source, capturedAt) {
  const safeIdCompany = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const safeIdSource = source.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");

  return {
    id: `event_${safeIdSource}_${safeIdCompany}`,
    rawName: companyName,
    website: "",
    sourceType: source.type || "conference",
    sourceName: source.name,
    sourceUrl: source.url,
    description:
      source.eventDescription ||
      `${companyName} appeared on ${source.name}. Public event/sponsor/exhibitor presence is treated as GTM visibility and market activity signal.`,
    homepageText: `${companyName} appeared on ${source.name}. This is a public GTM visibility signal.`,
    careersText: "",
    lastActivityDate: capturedAt.slice(0, 10),
    country: "",
    estimatedSize: "",
    stageHint: "conference_gtm_visibility_signal",
    agentConfidence: 0.55,
    expectedCategory: "real_source_unclassified",
    expectedTrashReason: ""
  };
}

function dedupeRows(rows) {
  const seen = new Set();
  const unique = [];

  for (const row of rows) {
    const companyName = getCompanyName(row);
    const sourceName = getSourceName(row);
    const sourceUrl = normalize(row.sourceUrl || row.website || "");

    if (isObviousJunk(companyName)) continue;

    const key = `${companyName.toLowerCase()}|${sourceName.toLowerCase()}|${sourceUrl.toLowerCase()}`;
    if (seen.has(key)) continue;

    seen.add(key);

    unique.push({
      ...row,
      rawName: row.rawName || companyName,
      sourceName,
      source: row.source || sourceName
    });
  }

  return unique;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const sources = await loadSources();
  const existingRows = await readJsonArray(OUT_JSON);
  const capturedAt = new Date().toISOString();

  if (sources.length === 0) {
    console.log("No SaaS/event sources configured.");
    console.log("Preserving existing rows.");
    await writeFile(OUT_JSON, JSON.stringify(existingRows, null, 2));
    await writeFile(OUT_CSV, toPipelineCsv(existingRows));
    console.log(`Merged rows: ${existingRows.length}`);
    process.exit(0);
  }

  const managedSourceNames = new Set(sources.map((source) => source.name));

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

      console.log(`found ${candidates.length} candidates`);

      for (const companyName of candidates) {
        newRows.push(toPipelineRow(companyName, source, capturedAt));
      }
    } catch (error) {
      console.log(
        `${source.name} failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }

  const mergedRows = dedupeRows([...keptExistingRows, ...newRows]);

  if (existingRows.length >= 100 && mergedRows.length < existingRows.length * 0.5) {
    console.error("SaaS extraction safety stop");
    console.error(`Before: ${existingRows.length}`);
    console.error(`After: ${mergedRows.length}`);
    console.error("Refusing to write because merge would remove too much.");
    process.exit(1);
  }

  console.log("");
  console.log(`Configured SaaS/event sources: ${sources.length}`);
  console.log(`Existing rows before events: ${existingRows.length}`);
  console.log(`Existing kept rows: ${keptExistingRows.length}`);
  console.log(`New SaaS/event candidates: ${newRows.length}`);
  console.log(`Merged rows: ${mergedRows.length}`);

  await writeFile(OUT_JSON, JSON.stringify(mergedRows, null, 2));
  await writeFile(OUT_CSV, toPipelineCsv(mergedRows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
