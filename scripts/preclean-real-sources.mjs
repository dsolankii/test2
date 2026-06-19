import fs from "node:fs";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const INPUT_JSON = dataPath("real-source-mentions.json");
const ACCEPTED_JSON = dataPath("real-source-mentions-preclean.json");
const REJECTED_JSON = dataPath("real-source-mentions-rejected-preclean.json");
const ACCEPTED_CSV = dataPath("real-source-mentions-preclean.csv");
const REJECTED_CSV = dataPath("real-source-mentions-rejected-preclean.csv");

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function cleanText(value = "") {
  return String(value)
    .replace(/[�]/g, "")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCompanyName(row) {
  return cleanText(row.rawName || row.companyName || row.company || row.name || row.title || "");
}

function normalizeName(name = "") {
  return cleanText(name)
    .toLowerCase()
    .replace(/\b(inc|inc\.|llc|ltd|ltd\.|corp|corp\.|corporation|company|co|co\.|limited|plc|gmbh|sa|ag)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function csvEscape(value) {
  const text = Array.isArray(value)
    ? value.join("; ")
    : typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value ?? "");

  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(filePath, rows) {
  const allKeys = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  const csv = [
    allKeys.map(csvEscape).join(","),
    ...rows.map((row) => allKeys.map((key) => csvEscape(row[key])).join(",")),
  ].join("\n");

  fs.writeFileSync(filePath, csv);
}

const exactNavigationLabels = new Set([
  "",
  "agenda",
  "speakers",
  "speaker",
  "tickets",
  "get tickets",
  "book tickets",
  "apply",
  "venue",
  "location",
  "networking",
  "sponsor us",
  "become a sponsor",
  "exhibitor portal",
  "attendee portal",
  "event",
  "events",
  "event organiser",
  "event organizer",
  "organiser",
  "organizer",
  "agenda speakers",
  "agenda & speakers",
  "parties side events",
  "parties & side events",
  "side events",
  "cmo summit",
  "cro summit",
  "cco summit",
  "meet a vc",
  "pitch competition",
]);

function isObviousEventLabel(name, row) {
  const normalized = normalizeName(name);
  const sourceText = cleanText(`${row.sourceName || ""} ${row.sourceType || ""} ${row.sourceUrl || ""}`).toLowerCase();

  if (exactNavigationLabels.has(normalized)) return true;

  if (
    sourceText.includes("conference") &&
    /^(agenda|speaker|speakers|tickets|sponsor|venue|networking|event|events|organiser|organizer)$/i.test(normalized)
  ) {
    return true;
  }

  if (/^shoptalk (fall|europe|luxe)$/i.test(name)) return true;
  if (/^web summit (rio|qatar|lisbon)?$/i.test(name.trim())) return true;
  if (/^saastr annual$/i.test(name.trim())) return true;

  return false;
}

function hardRejectReason(row, seenExactRows) {
  const name = getCompanyName(row);
  const normalized = normalizeName(name);

  if (!name) return "Missing company name.";
  if (normalized.length < 2) return "Company name too short to be useful.";

  const exactKey = [
    normalized,
    cleanText(row.sourceName || "").toLowerCase(),
    cleanText(row.sourceUrl || "").toLowerCase(),
    cleanText(row.description || row.homepageText || row.careersText || "").toLowerCase().slice(0, 400),
  ].join("|");

  if (seenExactRows.has(exactKey)) return "Exact duplicate source row.";

  if (isObviousEventLabel(name, row)) {
    return "Obvious event/navigation label, not a buyer company.";
  }

  const url = cleanText(row.sourceUrl || row.website || "").toLowerCase();
  const description = cleanText(row.description || row.homepageText || row.careersText || "").toLowerCase();

  if (!url && !description && name.length < 4) {
    return "Too little evidence to identify entity.";
  }

  return "";
}

const rows = readJson(INPUT_JSON);
const accepted = [];
const rejected = [];
const seenExactRows = new Set();

for (const row of rows) {
  const reason = hardRejectReason(row, seenExactRows);
  const name = getCompanyName(row);
  const normalized = normalizeName(name);

  const exactKey = [
    normalized,
    cleanText(row.sourceName || "").toLowerCase(),
    cleanText(row.sourceUrl || "").toLowerCase(),
    cleanText(row.description || row.homepageText || row.careersText || "").toLowerCase().slice(0, 400),
  ].join("|");

  if (reason) {
    rejected.push({
      ...row,
      rawName: name || row.rawName,
      precleanDecision: "hard_reject",
      precleanReason: reason,
      expectedCategory: "trash",
      expectedTrashReason: reason,
    });
  } else {
    seenExactRows.add(exactKey);
    accepted.push({
      ...row,
      rawName: name || row.rawName,
      precleanDecision: "accepted_for_ai_review",
      precleanReason: "Passed light hygiene filter. Lead quality left to AI.",
    });
  }
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(ACCEPTED_JSON, JSON.stringify(accepted, null, 2));
fs.writeFileSync(REJECTED_JSON, JSON.stringify(rejected, null, 2));
writeCsv(ACCEPTED_CSV, accepted);
writeCsv(REJECTED_CSV, rejected);

console.log("Light pre-clean complete");
console.log("------------------------");
console.log(`Raw rows: ${rows.length}`);
console.log(`Accepted for AI/company scoring: ${accepted.length}`);
console.log(`Hard rejected as obvious garbage: ${rejected.length}`);
console.log(`Wrote ${ACCEPTED_JSON}`);
console.log(`Wrote ${REJECTED_JSON}`);
