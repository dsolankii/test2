import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const INPUT = dataPath("real-source-mentions.json");
const ACCEPTED_JSON = dataPath("real-source-mentions-preclean.json");
const REJECTED_JSON = dataPath("real-source-mentions-rejected-preclean.json");

function textOf(...values) {
  return values
    .map((value) => String(value || ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[™®©]/g, "")
    .trim();
}

function sourceText(row) {
  return textOf(
    row.sourceName,
    row.sourceType,
    row.sourceUrl,
    row.website,
    row.url
  ).toLowerCase();
}

function evidenceText(row) {
  return textOf(
    row.rawName,
    row.companyName,
    row.title,
    row.jobTitle,
    row.role,
    row.description,
    row.snippet,
    row.signal,
    row.category,
    row.sourceName,
    row.sourceType,
    row.sourceUrl,
    row.website
  ).toLowerCase();
}

function hasHiringEvidence(row) {
  const text = evidenceText(row);

  return /\b(hiring|job|jobs|career|careers|role|opening|vacancy|apply|recruit|remote|engineer|developer|sales|account executive|marketing|growth|business development|customer success|revops|sdr|bdr|demand generation|head of|vp of|director of)\b/i.test(
    text
  );
}

function hasStartupOrBuyingSignal(row) {
  const text = evidenceText(row);

  return /\b(product hunt|y combinator|yc|launched|launch|funding|funded|raised|series a|series b|seed round|startup|saas|crm|sales automation|lead generation|outbound|go-to-market|gtm|pipeline|revenue)\b/i.test(
    text
  );
}

function isEventSponsorSource(row) {
  const text = sourceText(row);

  return /\b(sponsor|sponsors|sponsorship|partner|partners|partnership|exhibitor|exhibitors|expo|conference|summit|event|web summit|saastr|mwc|slush|tnw|sxsw|techcrunch disrupt|startup grind|bits and pretzels|london tech week|dublin tech summit|shoptalk|money20)\b/i.test(
    text
  );
}

function isObviousNavigationName(name) {
  const value = name.toLowerCase();

  return [
    "agenda",
    "tickets",
    "pricing",
    "sponsors",
    "partners",
    "exhibitors",
    "speakers",
    "venue",
    "register",
    "contact",
    "about",
    "privacy",
    "terms",
    "login",
    "sign in",
    "apply",
    "learn more",
    "view all",
    "read more",
  ].includes(value);
}

function isBadCompanyName(name) {
  const clean = normalizeName(name);
  const lower = clean.toLowerCase();

  if (!clean) return "missing_company_name";
  if (clean.length < 2) return "company_name_too_short";
  if (isObviousNavigationName(clean)) return "navigation_label";

  if (/^(http|www\.|\/|#)/i.test(clean)) return "url_as_company";
  if (/^[0-9\s\-_.:/]+$/.test(clean)) return "numeric_or_symbol_name";
  if (lower.length > 120) return "company_name_too_long";

  return "";
}

function companyName(row) {
  return normalizeName(
    row.rawName ||
      row.companyName ||
      row.cleanCompanyName ||
      row.name ||
      row.company ||
      ""
  );
}

function rowKey(row) {
  return [
    companyName(row).toLowerCase(),
    String(row.sourceName || "").toLowerCase(),
    String(row.sourceUrl || row.website || row.url || "").toLowerCase(),
    String(row.title || row.jobTitle || "").toLowerCase(),
  ].join("|");
}

function sourcePriority(row) {
  const source = sourceText(row);
  const evidence = evidenceText(row);

  if (/\b(remote ok|arbeitnow|remotive|jobicy|adzuna|hacker news|who is hiring)\b/i.test(source)) {
    return 1;
  }

  if (hasHiringEvidence(row)) return 2;

  if (/\b(product hunt|y combinator|yc)\b/i.test(source) || hasStartupOrBuyingSignal(row)) {
    return 3;
  }

  if (isEventSponsorSource(row)) return 9;

  return 5;
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

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

const rows = await readJsonArray(INPUT);

const accepted = [];
const rejected = [];
const seen = new Set();

for (const row of rows) {
  const name = companyName(row);
  const badNameReason = isBadCompanyName(name);

  if (badNameReason) {
    rejected.push({ ...row, precleanRejectedReason: badNameReason });
    continue;
  }

  const key = rowKey(row);

  if (seen.has(key)) {
    rejected.push({ ...row, precleanRejectedReason: "duplicate_source_row" });
    continue;
  }

  seen.add(key);

  const eventSponsorOnly = isEventSponsorSource(row);
  const hasRealSignal = hasHiringEvidence(row) || hasStartupOrBuyingSignal(row);

  if (eventSponsorOnly && !hasRealSignal) {
    rejected.push({
      ...row,
      precleanRejectedReason: "event_sponsor_or_exhibitor_without_hiring_or_buying_signal",
    });
    continue;
  }

  accepted.push({
    ...row,
    rawName: name,
    cleanCompanyName: name,
    precleanSourcePriority: sourcePriority(row),
  });
}

accepted.sort((a, b) => {
  const priorityA = Number(a.precleanSourcePriority || 9);
  const priorityB = Number(b.precleanSourcePriority || 9);

  if (priorityA !== priorityB) return priorityA - priorityB;

  const dateA = String(a.latestActivityDate || a.capturedAt || a.date || "");
  const dateB = String(b.latestActivityDate || b.capturedAt || b.date || "");

  if (dateA !== dateB) return dateB.localeCompare(dateA);

  return String(a.rawName || "").localeCompare(String(b.rawName || ""));
});

await writeJson(ACCEPTED_JSON, accepted);
await writeJson(REJECTED_JSON, rejected);

console.log("Signal-focused pre-clean complete");
console.log("---------------------------------");
console.log(`Data dir: ${DATA_DIR}`);
console.log(`Raw rows: ${rows.length}`);
console.log(`Accepted for LLM review: ${accepted.length}`);
console.log(`Rejected before LLM: ${rejected.length}`);
console.log(
  `Rejected event/sponsor-only rows: ${
    rejected.filter(
      (row) =>
        row.precleanRejectedReason ===
        "event_sponsor_or_exhibitor_without_hiring_or_buying_signal"
    ).length
  }`
);
console.log(`Wrote ${ACCEPTED_JSON}`);
console.log(`Wrote ${REJECTED_JSON}`);
