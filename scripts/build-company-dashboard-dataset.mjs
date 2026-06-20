import { readFile, writeFile, mkdir } from "fs/promises";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const PRE_CLEAN_PATH = dataPath("real-source-mentions-preclean.json");
const AI_PATH = dataPath("ai-enriched-company-leads.json");
const OUT_JSON = dataPath("company-dashboard-leads.json");
const OUT_CSV = dataPath("company-dashboard-leads.csv");
const RAW_COMPANY_MENTIONS = dataPath("raw-company-mentions.json");
const CURRENT_RUN_PATH = dataPath("current-live-run.json");

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

function keyForRow(row) {
  return clean(row.companyKey) || normalizeCompanyName(getCompanyName(row));
}

function getCompanyName(row) {
  return clean(
    row.rawName ||
      row.cleanCompanyName ||
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
      row.score
  );
}

function getConfidence(row) {
  return clampScore(
    row.aiConfidence ??
      row.confidence ??
      row.confidenceScore ??
      row.aiConfidenceScore
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
  if (raw.includes("research")) return "research_more";
  if (raw.includes("trash")) return "trash";
  if (raw.includes("not_relevant")) return "not_relevant";
  if (raw.includes("not relevant")) return "not_relevant";
  if (raw.includes("not_fit")) return "not_relevant";
  if (raw.includes("not fit")) return "not_relevant";

  if (score >= 85) return "hot_lead";
  if (score >= 70) return "warm_lead";
  if (score >= 50) return "nurture";
  if (score > 0) return "research_more";

  return "not_relevant";
}

function isBadLead(row, decision, score) {
  const aiBad =
    row.aiIsBadLead === true ||
    row.isBadLead === true ||
    clean(row.aiBadLeadReason || row.badLeadReason);

  return (
    aiBad ||
    score <= 0 ||
    decision === "trash" ||
    decision === "not_relevant"
  );
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

function sourceName(row) {
  return clean(row.sourceName || row.source || row.sourceType || "Public source");
}

function sourceUrl(row) {
  return clean(row.sourceUrl || row.url || row.link || row.website || "");
}

function latestTime(rows) {
  let latest = 0;

  for (const row of rows) {
    const raw =
      row.latestActivityDate ||
      row.lastActivityDate ||
      row.capturedAt ||
      row.updatedAt ||
      row.createdAt ||
      row.publishedAt ||
      row.date ||
      "";

    const parsed = Date.parse(String(raw));
    if (Number.isFinite(parsed)) latest = Math.max(latest, parsed);
  }

  return latest;
}

function pickLlmText(row, keys) {
  for (const key of keys) {
    const value = clean(row?.[key]);
    if (value) return value;
  }

  return "";
}

function csvEscape(value) {
  const text = Array.isArray(value)
    ? value.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item))).join("; ")
    : typeof value === "object" && value !== null
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
    "mentionTitle",
    "mentionCount",
    "icpFit",
    "buyerNeed",
    "salesMotion",
    "whyNow",
    "nextAction",
    "recommendedBuyer",
    "outreachAngle",
    "scoreReasoning",
    "capturedAt",
    "reviewStatus",
    "aiProvider",
    "aiModel",
    "aiReviewedAt"
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

async function readJsonObject(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

await mkdir(DATA_DIR, { recursive: true });

const precleanRows = await readJsonArray(PRE_CLEAN_PATH);
const aiRows = await readJsonArray(AI_PATH);
const currentRun = await readJsonObject(CURRENT_RUN_PATH);

const runId = currentRun.runId || "manual_run";
const runStartedAt = currentRun.startedAt || new Date().toISOString();

const mentionsByKey = new Map();

for (const row of precleanRows) {
  const companyName = getCompanyName(row);
  if (!companyName) continue;

  const key = keyForRow(row);
  if (!key) continue;

  if (!mentionsByKey.has(key)) {
    mentionsByKey.set(key, []);
  }

  mentionsByKey.get(key).push(row);
}

const rawCompanyMentions = [...mentionsByKey.entries()].map(([companyKey, mentions]) => ({
  companyKey,
  companyName: getCompanyName(mentions[0]),
  mentionCount: mentions.length,
  sources: [...new Set(mentions.map(sourceName).filter(Boolean))],
  latestCapturedAt: new Date(latestTime(mentions) || Date.now()).toISOString(),
  mentions
}));

const bestAiByKey = new Map();

for (const row of aiRows) {
  const companyName = getCompanyName(row);
  if (!companyName) continue;

  const key = keyForRow(row);
  if (!key) continue;

  const score = getLlmScore(row);
  const confidence = getConfidence(row);
  const existing = bestAiByKey.get(key);

  if (!existing) {
    bestAiByKey.set(key, row);
    continue;
  }

  const existingScore = getLlmScore(existing);
  const existingConfidence = getConfidence(existing);

  if (
    score > existingScore ||
    (score === existingScore && confidence > existingConfidence)
  ) {
    bestAiByKey.set(key, row);
  }
}

const dashboardRows = [];

for (const [companyKey, aiRow] of bestAiByKey.entries()) {
  const companyName = getCompanyName(aiRow);
  if (!companyName) continue;

  const mentions = mentionsByKey.get(companyKey) || [];
  const primaryMention = mentions[0] || aiRow;

  const score = getLlmScore(aiRow);
  const confidence = getConfidence(aiRow);
  const decision = getDecision(aiRow, score);

  const isBadLeadValue = isBadLead(aiRow, decision, score);

  const mentionCount =
    Number(aiRow.mentionCount || aiRow.mentionsCount || aiRow.mentions || 0) ||
    mentions.length ||
    1;

  const latest = latestTime(mentions.length ? mentions : [aiRow]) || Date.now();

  dashboardRows.push({
    ...aiRow,
    companyKey,
    companyName,
    rawName: getCompanyName(aiRow),
    decision,
    decisionLabel: readableDecision(decision),
    score,
    aiIntentScore: score,
    confidence,
    aiConfidence: confidence,
    reviewStatus: "reviewed",
    isBadLead: isBadLeadValue,
    sourceName: sourceName(aiRow) || sourceName(primaryMention),
    source: sourceName(aiRow) || sourceName(primaryMention),
    sourceUrl: sourceUrl(aiRow) || sourceUrl(primaryMention),
    sourceType: clean(aiRow.sourceType || primaryMention.sourceType || ""),
    signal: clean(
      aiRow.signal ||
        aiRow.aiScoreReasoning ||
        aiRow.aiWhyNow ||
        primaryMention.signal ||
        primaryMention.description ||
        "LLM-reviewed public signal"
    ),
    mentionTitle: clean(primaryMention.mentionTitle || primaryMention.title || ""),
    mentionCount,
    capturedAt: new Date(latest).toISOString(),

    icpFit: pickLlmText(aiRow, ["aiIcpFit", "icpFit"]),
    buyerNeed: pickLlmText(aiRow, ["aiBuyerNeed", "buyerNeed"]),
    salesMotion: pickLlmText(aiRow, ["aiSalesMotion", "salesMotion"]),
    whyNow: pickLlmText(aiRow, ["aiWhyNow", "whyNow", "why_now"]),
    nextAction: pickLlmText(aiRow, ["aiNextAction", "nextAction", "recommendedAction", "action", "next_action"]),
    recommendedBuyer: pickLlmText(aiRow, ["aiRecommendedBuyer", "recommendedBuyer"]),
    outreachAngle: pickLlmText(aiRow, ["aiOutreachAngle", "outreachAngle"]),
    scoreReasoning: pickLlmText(aiRow, ["aiScoreReasoning", "scoreReasoning", "reason"]),

    runId,
    runStartedAt
  });
}

dashboardRows.sort((a, b) => {
  const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
  if (scoreDiff !== 0) return scoreDiff;

  const confidenceDiff = Number(b.confidence || 0) - Number(a.confidence || 0);
  if (confidenceDiff !== 0) return confidenceDiff;

  const mentionDiff = Number(b.mentionCount || 0) - Number(a.mentionCount || 0);
  if (mentionDiff !== 0) return mentionDiff;

  return Date.parse(b.capturedAt || "") - Date.parse(a.capturedAt || "");
});

await writeFile(OUT_JSON, JSON.stringify(dashboardRows, null, 2));
await writeFile(OUT_CSV, toCsv(dashboardRows));
await writeFile(RAW_COMPANY_MENTIONS, JSON.stringify(rawCompanyMentions, null, 2));

const excludedByLlm = [...bestAiByKey.values()].filter((row) => {
  const score = getLlmScore(row);
  const decision = getDecision(row, score);
  return isBadLead(row, decision, score);
}).length;

console.log("LLM-only lead queue dataset built");
console.log("---------------------------------");
console.log(`Run ID: ${runId}`);
console.log(`Pre-clean rows used as evidence only: ${precleanRows.length}`);
console.log(`Unique pre-clean companies: ${mentionsByKey.size}`);
console.log(`LLM-reviewed companies available: ${aiRows.length}`);
console.log(`Best LLM-reviewed companies after dedupe: ${bestAiByKey.size}`);
console.log(`LLM-excluded companies: ${excludedByLlm}`);
console.log(`Final visible LLM-reviewed leads: ${dashboardRows.length}`);
console.log(`Pending/unreviewed fallback leads: 0`);
console.log(`Wrote ${OUT_JSON}`);
console.log(`Wrote ${OUT_CSV}`);
console.log(`Updated ${RAW_COMPANY_MENTIONS}`);
