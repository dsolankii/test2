import { readFile, writeFile, mkdir } from "fs/promises";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const AI_PATH = dataPath("ai-enriched-company-leads.json");
const OUT_JSON = dataPath("company-dashboard-leads.json");
const OUT_CSV = dataPath("company-dashboard-leads.csv");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCompanyName(name = "") {
  return clean(name)
    .toLowerCase()
    .replace(/\b(inc|inc\.|llc|ltd|ltd\.|corp|corp\.|corporation|company|co|co\.|limited|plc|gmbh|sa|ag)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCompanyName(row) {
  return clean(
    row.rawName ||
      row.cleanCompanyName ||
      row.companyName ||
      row.company ||
      row.name ||
      row.aiCompanyName ||
      row.accountName ||
      row.organization ||
      row.organisation ||
      row.employer ||
      row.title ||
      ""
  );
}

function getCompanyKey(row) {
  return clean(row.companyKey) || normalizeCompanyName(getCompanyName(row));
}

function toNumber(value) {
  const raw = typeof value === "string" ? value.replace("%", "").trim() : value;
  const number = Number(raw);
  return Number.isFinite(number) ? number : 0;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value))));
}

function getLlmScore(row) {
  return clampScore(
    row.aiIntentScore ??
      row.intentScore ??
      row.leadScore ??
      row.score ??
      row.aiScore ??
      0
  );
}

function getConfidence(row) {
  return clampScore(
    row.aiConfidence ??
      row.confidence ??
      row.confidenceScore ??
      row.aiConfidenceScore ??
      0
  );
}

function getDecision(row, score) {
  const raw = clean(
    row.aiDecision ||
      row.decision ||
      row.buyingStage ||
      row.aiBuyingStage ||
      row.status ||
      row.leadStatus ||
      ""
  ).toLowerCase();

  if (raw.includes("hot")) return "hot_lead";
  if (raw.includes("warm")) return "warm_lead";
  if (raw.includes("nurture")) return "nurture";
  if (raw.includes("research") || raw.includes("review")) return "research_more";
  if (raw.includes("trash")) return "trash";
  if (raw.includes("not_relevant") || raw.includes("not relevant")) return "not_relevant";

  if (score >= 85) return "hot_lead";
  if (score >= 70) return "warm_lead";
  if (score >= 50) return "nurture";
  if (score > 0) return "research_more";

  return "reviewed";
}

function readableDecision(decision) {
  if (decision === "hot_lead") return "High Intent";
  if (decision === "warm_lead") return "Qualified";
  if (decision === "nurture") return "Monitor";
  if (decision === "research_more") return "Needs Review";
  if (decision === "trash") return "Excluded";
  if (decision === "not_relevant") return "Excluded";
  return "Reviewed";
}

function pick(row, keys) {
  for (const key of keys) {
    const value = clean(row?.[key]);
    if (value) return value;
  }
  return "";
}

function csvEscape(value) {
  const text =
    typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value ?? "");

  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows) {
  const headers = [
    "companyKey",
    "companyName",
    "decision",
    "decisionLabel",
    "score",
    "aiIntentScore",
    "confidence",
    "sourceName",
    "sourceUrl",
    "sourceType",
    "signal",
    "icpFit",
    "buyerNeed",
    "salesMotion",
    "whyNow",
    "nextAction",
    "recommendedBuyer",
    "outreachAngle",
    "scoreReasoning",
    "reviewStatus",
    "aiProvider",
    "aiModel",
    "aiReviewedAt",
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

await mkdir(DATA_DIR, { recursive: true });

const aiRows = await readJsonArray(AI_PATH);
const bestByKey = new Map();

for (const row of aiRows) {
  const companyName = getCompanyName(row);
  if (!companyName) continue;

  const companyKey = getCompanyKey(row);
  if (!companyKey) continue;

  const existing = bestByKey.get(companyKey);
  if (!existing) {
    bestByKey.set(companyKey, row);
    continue;
  }

  const score = getLlmScore(row);
  const existingScore = getLlmScore(existing);
  const confidence = getConfidence(row);
  const existingConfidence = getConfidence(existing);

  if (score > existingScore || (score === existingScore && confidence > existingConfidence)) {
    bestByKey.set(companyKey, row);
  }
}

const dashboardRows = [...bestByKey.entries()].map(([companyKey, row]) => {
  const score = getLlmScore(row);
  const confidence = getConfidence(row);
  const decision = getDecision(row, score);
  const now = new Date().toISOString();

  return {
    ...row,
    companyKey,
    companyName: getCompanyName(row),
    rawName: getCompanyName(row),
    decision,
    decisionLabel: readableDecision(decision),
    score,
    aiIntentScore: score,
    confidence,
    aiConfidence: confidence,
    reviewStatus: "reviewed",
    sourceName: pick(row, ["sourceName", "source", "sourcePlatform", "platform", "sourceType"]) || "Public source",
    source: pick(row, ["sourceName", "source", "sourcePlatform", "platform", "sourceType"]) || "Public source",
    sourceUrl: pick(row, ["sourceUrl", "url", "link", "website", "companyUrl"]),
    sourceType: pick(row, ["sourceType", "signalType", "category"]),
    signal: pick(row, ["signal", "aiEvidence", "evidence", "reason", "description", "mentionTitle", "aiScoreReasoning"]),
    icpFit: pick(row, ["aiIcpFit", "icpFit"]),
    buyerNeed: pick(row, ["aiBuyerNeed", "buyerNeed"]),
    salesMotion: pick(row, ["aiSalesMotion", "salesMotion"]),
    whyNow: pick(row, ["aiWhyNow", "whyNow", "why_now"]),
    nextAction: pick(row, ["aiNextAction", "nextAction", "recommendedAction", "action", "next_action"]),
    recommendedBuyer: pick(row, ["aiRecommendedBuyer", "recommendedBuyer"]),
    outreachAngle: pick(row, ["aiOutreachAngle", "outreachAngle"]),
    scoreReasoning: pick(row, ["aiScoreReasoning", "scoreReasoning", "reason"]),
    aiProvider: row.aiProvider || process.env.AI_PROVIDER || "gemini",
    aiModel: row.aiModel || process.env.AI_MODEL || "",
    aiReviewedAt: row.aiReviewedAt || row.reviewedAt || now,
    capturedAt: row.capturedAt || row.updatedAt || row.createdAt || now
  };
});

dashboardRows.sort((a, b) => {
  const seqA = Number(a.aiEnrichedSeq || 0);
  const seqB = Number(b.aiEnrichedSeq || 0);

  if (seqA !== seqB) return seqA - seqB;

  return String(a.companyName || "").localeCompare(String(b.companyName || ""));
});

await writeFile(OUT_JSON, JSON.stringify(dashboardRows, null, 2));
await writeFile(OUT_CSV, toCsv(dashboardRows));

console.log("Stable LLM-only dashboard built");
console.log("-------------------------------");
console.log(`LLM reviewed input rows: ${aiRows.length}`);
console.log(`Final dashboard rows: ${dashboardRows.length}`);
console.log("Fallback rows: 0");
console.log(`Wrote ${OUT_JSON}`);
console.log(`Wrote ${OUT_CSV}`);
