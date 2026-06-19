import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const ROOT = process.cwd();
const CONFIG_PATH = dataPath("open-lead-rss-sources.json");
const OUT_JSON = dataPath("real-source-mentions.json");
const OUT_CSV = dataPath("real-source-mentions.csv");

function clean(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
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
      row.title ||
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
  if (/^https?:\/\//i.test(name)) return true;
  if (/^\d+$/.test(name)) return true;
  if (/[{}[\]|<>]/.test(name)) return true;
  if (/\.(png|jpg|jpeg|svg|gif|webp|css|js|ico)$/i.test(name)) return true;

  return [
    "home",
    "login",
    "register",
    "tickets",
    "agenda",
    "contact",
    "book tickets",
    "buy tickets",
    "view agenda",
    "search",
    "menu",
    "open",
    "close",
    "next",
    "previous",
    "privacy",
    "terms",
    "cookie",
    "newsletter",
    "subscribe",
    "header",
    "footer",
    "json",
    "rsd"
  ].includes(lower);
}

function extractTagItems(xml) {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
}

function tagValue(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? clean(match[1]) : "";
}

function guessCompanyFromTitle(title) {
  const cleaned = clean(title);

  const patterns = [
    /^(.+?)\s+is hiring/i,
    /^(.+?)\s*:\s+.+$/i,
    /^(.+?)\s+-\s+.+$/i,
    /^(.+?)\s+at\s+.+$/i
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match && match[1]) return clean(match[1]);
  }

  return cleaned;
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

async function readJsonArray(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; LeadGridSignalBot/1.0)",
      Accept: "application/rss+xml,application/xml,text/xml,text/html,*/*"
    }
  });

  if (!response.ok) throw new Error(`Fetch failed ${response.status}: ${url}`);
  return response.text();
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const sources = await readJsonArray(CONFIG_PATH);
  const existingRows = await readJsonArray(OUT_JSON);
  const capturedAt = new Date().toISOString();

  const newRows = [];

  for (const source of sources) {
    console.log(`Collecting ${source.name}`);

    try {
      const xml = await fetchText(source.url);
      const items = extractTagItems(xml);
      let count = 0;

      for (const item of items) {
        const title = tagValue(item, "title");
        const link = tagValue(item, "link") || source.url;
        const companyName = guessCompanyFromTitle(title);

        if (isObviousJunk(companyName)) continue;

        newRows.push({
          companyName,
          sourceName: source.name,
          source: source.name,
          sourceType: source.type || "rss",
          sourceUrl: link,
          signal: "Hiring signal",
          mentionTitle: title || `${companyName} appeared on ${source.name}`,
          capturedAt
        });

        count += 1;
      }

      console.log(`${source.name} extracted: ${count}`);
    } catch (error) {
      console.log(`${source.name} failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  const seen = new Set();
  const mergedRows = [];

  // Preserve existing rows first. Do not filter them here.
  for (const row of existingRows) {
    const companyName = getCompanyName(row);
    const sourceName = getSourceName(row);
    const key = `${companyName || JSON.stringify(row)}::${sourceName}`;

    if (seen.has(key)) continue;
    seen.add(key);

    mergedRows.push(row);
  }

  // Append only new RSS rows.
  for (const row of newRows) {
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

  if (existingRows.length >= 100 && mergedRows.length < existingRows.length) {
    console.error("RSS safety stop");
    console.error(`Before: ${existingRows.length}`);
    console.error(`After: ${mergedRows.length}`);
    process.exit(1);
  }

  console.log("");
  console.log(`Existing rows: ${existingRows.length}`);
  console.log(`New RSS rows: ${newRows.length}`);
  console.log(`Merged rows: ${mergedRows.length}`);

  await writeFile(OUT_JSON, JSON.stringify(mergedRows, null, 2));
  await writeFile(OUT_CSV, toCsv(mergedRows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
