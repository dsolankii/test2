import { readFile, writeFile } from "fs/promises";
import path from "path";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const ROOT = process.cwd();
const IN_JSON = dataPath("real-source-mentions.json");
const OUT_CSV = dataPath("real-source-mentions.csv");

const BAD_EXACT = new Set([
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
  "partnership showroom",
  "terms & conditions",
  "terms &#038; conditions",
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
  "click to open the search input field",
  "feast your mind",
  "global village",
  "interact",
  "dublin tech summit",
  "copyright and company info"
]);

const BAD_CONTAINS = [
  "powered by",
  "all rights reserved",
  "cookie policy",
  "sustainability policy",
  "early-table",
  "feature sessions",
  "dts partners - currently trusted",
  "currently trusted by_",
  "dts-partners-currently-trusted",
  "icon:",
  "oembed",
  "» feed",
  "comments feed",
  "rss2 feed",
  "dts logo"
];

function clean(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&raquo;/g, "»")
    .replace(/\s+/g, " ")
    .trim();
}

function getCompanyName(row) {
  return clean(
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
  return clean(row.sourceName || row.source || row.sourceType || "Public source");
}

function isObviousJunk(value) {
  const name = clean(value);
  const lower = name.toLowerCase();

  if (!name) return true;
  if (name.length < 2 || name.length > 140) return true;
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
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
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

const raw = await readFile(IN_JSON, "utf8");
const rows = JSON.parse(raw);

const seen = new Set();
const cleanedRows = [];

for (const row of rows) {
  const companyName = getCompanyName(row);
  const sourceName = getSourceName(row);

  if (isObviousJunk(companyName)) continue;

  const key = `${companyName.toLowerCase()}::${sourceName.toLowerCase()}`;
  if (seen.has(key)) continue;
  seen.add(key);

  cleanedRows.push({
    ...row,
    companyName,
    sourceName,
    source: row.source || sourceName
  });
}

if (rows.length >= 100 && cleanedRows.length < rows.length * 0.7) {
  console.error("Cleanup safety stop");
  console.error(`Before: ${rows.length}`);
  console.error(`After: ${cleanedRows.length}`);
  console.error("Refusing to write because cleanup would remove too much.");
  process.exit(1);
}

await writeFile(IN_JSON, JSON.stringify(cleanedRows, null, 2));
await writeFile(OUT_CSV, toCsv(cleanedRows));

console.log("Source cleanup complete");
console.log(`Before: ${rows.length}`);
console.log(`After: ${cleanedRows.length}`);
console.log(`Removed: ${rows.length - cleanedRows.length}`);
