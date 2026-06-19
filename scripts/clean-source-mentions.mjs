import { readFile, writeFile, mkdir } from "fs/promises";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const IN_JSON = dataPath("real-source-mentions.json");
const OUT_CSV = dataPath("real-source-mentions.csv");

const BAD_EXACT = new Set([
  "",
  "home",
  "login",
  "register",
  "tickets",
  "agenda",
  "contact",
  "contact us",
  "book tickets",
  "buy tickets",
  "watch now",
  "view agenda",
  "download on the app store",
  "download on google play",
  "partners",
  "partnerships",
  "terms & conditions",
  "terms and conditions",
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
  "click to start search",
  "click to open the search input field"
]);

const BAD_CONTAINS = [
  "powered by",
  "all rights reserved",
  "cookie policy",
  "sustainability policy",
  "comments feed",
  "rss2 feed",
  "oembed",
  "icon:"
];

function clean(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&raquo;/g, "»")
    .replace(/[�]/g, "")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCompanyName(row) {
  return clean(
    row.rawName ||
      row.companyName ||
      row.company ||
      row.name ||
      row.organization ||
      row.organisation ||
      row.employer ||
      row.title ||
      ""
  );
}

function getSourceName(row) {
  return clean(row.sourceName || row.source || row.sourceType || "Public source");
}

function normalizeKey(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/\b(inc|inc\.|llc|ltd|ltd\.|corp|corp\.|corporation|company|co|co\.|limited|plc|gmbh|sa|ag)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isObviousJunk(value) {
  const name = clean(value);
  const lower = name.toLowerCase();

  if (!name) return true;
  if (name.length < 2 || name.length > 180) return true;
  if (BAD_EXACT.has(lower)) return true;
  if (BAD_CONTAINS.some((phrase) => lower.includes(phrase))) return true;
  if (/^https?:\/\//i.test(name)) return true;
  if (/^\d+$/.test(name)) return true;
  if (/[{}[\]|<>]/.test(name)) return true;
  if (/\.(png|jpg|jpeg|svg|gif|webp|css|js|ico)$/i.test(name)) return true;
  if (/-\d+x\d+$/i.test(name)) return true;
  if (/\b\d+x\d+\b/i.test(name)) return true;

  return false;
}

function csvEscape(value) {
  const text = Array.isArray(value)
    ? value.join("; ")
    : typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value ?? "");

  const cleaned = text.replace(/\r?\n|\r/g, " ").replace(/\s+/g, " ").trim();
  return `"${cleaned.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  const preferredHeaders = [
    "id",
    "rawName",
    "companyName",
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
    "expectedTrashReason",
    "signal",
    "mentionTitle",
    "capturedAt"
  ];

  const extraHeaders = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  ).filter((key) => !preferredHeaders.includes(key));

  const headers = [...preferredHeaders, ...extraHeaders];

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ].join("\n");
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const raw = await readFile(IN_JSON, "utf8");
  const rows = JSON.parse(raw);
  const seen = new Set();
  const cleanedRows = [];

  let missingCompanyName = 0;
  let junk = 0;
  let duplicates = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const companyName = getCompanyName(row);
    const sourceName = getSourceName(row);
    const sourceUrl = clean(row.sourceUrl || row.website || "");

    if (!companyName) {
      missingCompanyName += 1;
      continue;
    }

    if (isObviousJunk(companyName)) {
      junk += 1;
      continue;
    }

    const key = [
      normalizeKey(companyName),
      sourceName.toLowerCase(),
      sourceUrl.toLowerCase()
    ].join("|");

    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }

    seen.add(key);

    cleanedRows.push({
      ...row,
      rawName: row.rawName || companyName,
      companyName: row.companyName || companyName,
      sourceName,
      source: row.source || sourceName
    });
  }

  if (rows.length >= 100 && cleanedRows.length < rows.length * 0.2) {
    console.error("Cleanup safety stop");
    console.error(`Before: ${rows.length}`);
    console.error(`After: ${cleanedRows.length}`);
    console.error(`Missing company names: ${missingCompanyName}`);
    console.error(`Junk removed: ${junk}`);
    console.error(`Duplicates removed: ${duplicates}`);
    console.error(`Example first row keys: ${Object.keys(rows[0] || {}).join(", ")}`);
    console.error(`Example first row rawName: ${rows[0]?.rawName || ""}`);
    console.error(`Example first row companyName: ${rows[0]?.companyName || ""}`);
    console.error("Refusing to write because cleanup would remove too much.");
    process.exit(1);
  }

  await writeFile(IN_JSON, JSON.stringify(cleanedRows, null, 2));
  await writeFile(OUT_CSV, toCsv(cleanedRows));

  console.log("Source cleanup complete");
  console.log(`Before: ${rows.length}`);
  console.log(`After: ${cleanedRows.length}`);
  console.log(`Missing company names: ${missingCompanyName}`);
  console.log(`Junk removed: ${junk}`);
  console.log(`Duplicates removed: ${duplicates}`);
  console.log(`Removed total: ${rows.length - cleanedRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
