import fs from "node:fs";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const INPUT_JSON = dataPath("real-source-mentions.json");
const OUTPUT_JSON = dataPath("real-source-mentions-clean.json");
const OUTPUT_CSV = dataPath("real-source-mentions-clean.csv");

const positiveRoleKeywords = [
  "sales",
  "account executive",
  "account manager",
  "business development",
  "sdr",
  "bdr",
  "revenue",
  "revops",
  "growth",
  "growth marketing",
  "demand generation",
  "marketing",
  "partnerships",
  "partner manager",
  "customer success",
  "customer support lead",
  "head of content",
  "content marketing",
  "seo",
  "go-to-market",
  "gtm",
  "commercial",
  "lead generation",
  "pipeline",
];

const positiveCompanyKeywords = [
  "saas",
  "b2b",
  "software",
  "platform",
  "automation",
  "crm",
  "revenue",
  "sales",
  "marketing",
  "customer success",
  "growth",
  "analytics",
  "ai",
  "workflow",
  "product",
];

const negativeRoleKeywords = [
  "clinical",
  "nurse",
  "doctor",
  "medical",
  "pharmacy",
  "pharmacist",
  "care coordinator",
  "admin assistant",
  "administrative assistant",
  "virtual assistant",
  "data entry",
  "transcription",
  "legal assistant",
  "bookkeeper",
  "accountant",
  "payroll",
  "translator",
  "teacher",
  "tutor",
  "driver",
  "warehouse",
  "recruiter",
  "recruitment consultant",
  "clinical research",
  "cra",
];

const badCompanyWords = [
  "hires",
  "staffing",
  "recruitment",
  "recruiting",
  "talent agency",
  "consulting",
];

function cleanText(value = "") {
  return String(value)
    .replace(/\u00e2\u0080\u0094/g, "—")
    .replace(/\u00e2\u0080\u0093/g, "–")
    .replace(/\u00e2\u0080\u0099/g, "'")
    .replace(/\u00c2\u00a3/g, "£")
    .replace(/[ØÙ]+/g, "")
    .replace(/[�]/g, "")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, keywords) {
  const value = cleanText(text).toLowerCase();
  return keywords.some((keyword) => value.includes(keyword));
}

function getJobTitle(row) {
  return cleanText(row.description || "").split(". Tags:")[0].split(". Category:")[0].split(". Industry:")[0];
}

function isConference(row) {
  return row.sourceType === "conference";
}

function isLikelyBadCompany(row) {
  const name = cleanText(row.rawName).toLowerCase();
  return badCompanyWords.some((word) => name.includes(word));
}

function hasPositiveRole(row) {
  const title = getJobTitle(row);
  return includesAny(title, positiveRoleKeywords);
}

function hasPositiveCompanyContext(row) {
  const text = [
    row.description,
    row.homepageText,
    row.careersText,
    row.stageHint,
  ]
    .filter(Boolean)
    .join(" ");

  return includesAny(text, positiveCompanyKeywords);
}

function hasNegativeRole(row) {
  const title = getJobTitle(row);
  return includesAny(title, negativeRoleKeywords);
}

function classifyRow(row) {
  if (isConference(row)) {
    return {
      keep: true,
      category: "conference_gtm_signal",
      confidence: 0.6,
      reason: "Conference/exhibitor presence is useful GTM visibility signal.",
    };
  }

  if (isLikelyBadCompany(row)) {
    return {
      keep: false,
      category: "removed_recruiting_or_staffing",
      confidence: 0.2,
      reason: "Recruiting/staffing company is not the ICP.",
    };
  }

  if (hasNegativeRole(row)) {
    return {
      keep: false,
      category: "removed_low_fit_role",
      confidence: 0.25,
      reason: "Role is admin, medical, clinical, or otherwise low-fit for outbound support.",
    };
  }

  if (hasPositiveRole(row)) {
    return {
      keep: true,
      category: "high_intent_hiring_signal",
      confidence: 0.9,
      reason: "Job title directly matches sales, revenue, growth, marketing, partnerships, or customer success intent.",
    };
  }

  if (hasPositiveCompanyContext(row)) {
    return {
      keep: true,
      category: "medium_intent_company_context",
      confidence: 0.65,
      reason: "Company/job text contains SaaS, B2B, platform, AI, revenue, sales, or growth context.",
    };
  }

  return {
    keep: false,
    category: "removed_weak_signal",
    confidence: 0.3,
    reason: "No strong hiring, GTM, SaaS, B2B, revenue, or growth signal.",
  };
}

function csvEscape(value) {
  if (value === undefined || value === null) return "";
  const str = Array.isArray(value) ? value.join("; ") : String(value);
  const cleaned = cleanText(str);
  return `"${cleaned.replace(/"/g, '""')}"`;
}

function writeCsv(rows, path) {
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
    "expectedTrashReason",
  ];

  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");

  fs.writeFileSync(path, csv);
}

function dedupe(rows) {
  const seen = new Set();
  const result = [];

  for (const row of rows) {
    const key = [
      cleanText(row.rawName).toLowerCase(),
      cleanText(row.website || "").toLowerCase(),
      cleanText(row.sourceName || "").toLowerCase(),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }

  return result;
}

function main() {
  if (!fs.existsSync(INPUT_JSON)) {
    console.error(`Missing ${INPUT_JSON}. Run node scripts/collect-sources.mjs first.`);
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(INPUT_JSON, "utf-8"));

  const kept = [];
  const removed = [];

  for (const row of rows) {
    const classification = classifyRow(row);

    const cleanedRow = {
      ...row,
      rawName: cleanText(row.rawName),
      website: cleanText(row.website || ""),
      description: cleanText(row.description || ""),
      homepageText: cleanText(row.homepageText || ""),
      careersText: cleanText(row.careersText || ""),
      country: cleanText(row.country || ""),
      agentConfidence: classification.confidence,
      expectedCategory: classification.category,
      expectedTrashReason: classification.keep ? "" : classification.reason,
    };

    if (classification.keep) {
      kept.push(cleanedRow);
    } else {
      removed.push(cleanedRow);
    }
  }

  const uniqueKept = dedupe(kept);

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(uniqueKept, null, 2));
  writeCsv(uniqueKept, OUTPUT_CSV);

  const bySource = uniqueKept.reduce((acc, row) => {
    acc[row.sourceName] = (acc[row.sourceName] || 0) + 1;
    return acc;
  }, {});

  const removedByReason = removed.reduce((acc, row) => {
    acc[row.expectedCategory] = (acc[row.expectedCategory] || 0) + 1;
    return acc;
  }, {});

  console.log("");
  console.log("Cleaned real source data");
  console.log(`Input rows: ${rows.length}`);
  console.log(`Kept rows: ${uniqueKept.length}`);
  console.log(`Removed rows: ${removed.length}`);
  console.log("");
  console.log("Kept by source:");
  console.table(bySource);
  console.log("");
  console.log("Removed by reason:");
  console.table(removedByReason);
  console.log("");
  console.log(`Wrote ${OUTPUT_JSON}`);
  console.log(`Wrote ${OUTPUT_CSV}`);
}

main();
