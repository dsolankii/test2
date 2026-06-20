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

function keyFor(value) {
  return clean(value).toLowerCase();
}

function getCompanyName(row) {
  return clean(row.rawName || 
    row.companyName ||
      row.company ||
      row.name ||
      row.organization ||
      row.organisation ||
      row.employer ||
      ""
  );
}

function getScore(row) {
  const raw =
    row.aiIntentScore ??
    row.intentScore ??
    row.leadScore ??
    row.score ??
    row.fitScore ??
    0;

  const value =
    typeof raw === "string"
      ? Number(raw.replace("%", "").trim())
      : Number(raw);

  return Number.isFinite(value) ? value : 0;
}

function getConfidence(row) {
  const raw = row.confidence ?? row.confidenceScore ?? row.aiConfidence ?? 0;

  const value =
    typeof raw === "string"
      ? Number(raw.replace("%", "").trim())
      : Number(raw);

  return Number.isFinite(value) ? value : 0;
}

function getDecision(row, score) {
  const raw = clean(
    row.decision ||
      row.fit ||
      row.status ||
      row.leadStatus ||
      row.recommendation ||
      ""
  ).toLowerCase();

  if (raw.includes("hot")) return "hot_lead";
  if (raw.includes("warm")) return "warm_lead";
  if (raw.includes("nurture")) return "nurture";
  if (raw.includes("research")) return "research_more";
  if (raw.includes("not_relevant")) return "research_more";
  if (raw.includes("not relevant")) return "research_more";
  if (raw.includes("trash")) return "trash";
  if (raw.includes("not_fit")) return "trash";

  if (score >= 85) return "hot_lead";
  if (score >= 70) return "warm_lead";
  if (score >= 45) return "nurture";
  if (score > 0) return "research_more";

  return "review_pending";
}

function isTrashDecision(decision) {
  const value = clean(decision).toLowerCase();

  return (
    value === "trash" ||
    value.includes("trash") ||
    value.includes("not_fit") ||
    value.includes("not fit")
  );
}

function sourceName(row) {
  return clean(row.sourceName || row.source || row.sourceType || "Public source");
}

function sourceUrl(row) {
  return clean(row.sourceUrl || row.url || row.link || "");
}

function latestTime(rows) {
  let latest = 0;

  for (const row of rows) {
    const raw =
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

function readableDecision(decision) {
  if (decision === "hot_lead") return "Hot Lead";
  if (decision === "warm_lead") return "Warm Lead";
  if (decision === "nurture") return "Nurture";
  if (decision === "research_more") return "Research";
  if (decision === "review_pending") return "Review Pending";
  return "Review";
}

function pickText(row, keys, fallback) {
  for (const key of keys) {
    const value = clean(row?.[key]);
    if (value) return value;
  }

  return fallback;
}

function guessPendingScore(mentions) {
  const sources = new Set(mentions.map(sourceName).filter(Boolean));
  const sourceText = [...sources].join(" ").toLowerCase();

  let score = 35;

  if (mentions.length >= 2) score += 8;
  if (mentions.length >= 4) score += 7;

  if (sourceText.includes("job") || sourceText.includes("remote") || sourceText.includes("adzuna")) {
    score += 8;
  }

  if (
    sourceText.includes("summit") ||
    sourceText.includes("saastr") ||
    sourceText.includes("saastock") ||
    sourceText.includes("techcrunch") ||
    sourceText.includes("shoptalk") ||
    sourceText.includes("mwc")
  ) {
    score += 6;
  }

  return Math.min(score, 60);
}


function buildNextAction({ reviewed, decision, score, source, aiRow }) {
  const existing =
    aiRow?.nextAction ||
    aiRow?.next_action ||
    aiRow?.recommendedAction ||
    aiRow?.action;

  const generic =
    !existing ||
    clean(existing).toLowerCase() === "review account and decide outreach angle.";

  if (!generic) return clean(existing);

  if (!reviewed) {
    return "Run qualification review first, then decide whether this company should enter outreach.";
  }

  const sourceText = clean(source).toLowerCase();

  if (decision === "hot_lead" || score >= 85) {
    if (sourceText.includes("job") || sourceText.includes("remote") || sourceText.includes("adzuna")) {
      return "Prioritize for outreach. Use the active hiring signal as the opener.";
    }

    if (
      sourceText.includes("summit") ||
      sourceText.includes("saastr") ||
      sourceText.includes("saastock") ||
      sourceText.includes("techcrunch") ||
      sourceText.includes("shoptalk") ||
      sourceText.includes("mwc")
    ) {
      return "Prioritize for outreach. Reference the event signal and offer outbound support.";
    }

    return "Prioritize for outreach and write a direct sales-intent opener.";
  }

  if (decision === "warm_lead" || score >= 70) {
    return "Research the likely buyer, then prepare a warm outbound angle.";
  }

  if (decision === "nurture" || score >= 45) {
    return "Add to nurture and monitor for a stronger buying signal.";
  }

  return "Review manually before adding this company to outreach.";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows) {
  const headers = [
    "companyName",
    "decision",
    "score",
    "confidence",
    "sourceName",
    "sourceUrl",
    "icpFit",
    "whyNow",
    "nextAction",
    "capturedAt",
    "reviewStatus"
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

const mentionsByCompany = new Map();

for (const row of precleanRows) {
  const companyName = getCompanyName(row);
  if (!companyName) continue;

  const key = keyFor(companyName);

  if (!mentionsByCompany.has(key)) {
    mentionsByCompany.set(key, []);
  }

  mentionsByCompany.get(key).push(row);
}

const aiByCompany = new Map();

for (const row of aiRows) {
  const companyName = getCompanyName(row);
  if (!companyName) continue;
  aiByCompany.set(keyFor(companyName), row);
}

const rawCompanyMentions = [...mentionsByCompany.entries()].map(([key, mentions]) => ({
  companyKey: key,
  companyName: getCompanyName(mentions[0]),
  mentionCount: mentions.length,
  sources: [...new Set(mentions.map(sourceName).filter(Boolean))],
  latestCapturedAt: new Date(latestTime(mentions) || Date.now()).toISOString(),
  mentions
}));

const dashboardRows = [];

for (const [companyKey, mentions] of mentionsByCompany.entries()) {
  const primaryMention = mentions[0] || {};
  const companyName = getCompanyName(primaryMention);
  if (!companyName) continue;

  const aiRow = aiByCompany.get(companyKey);
  const reviewed = Boolean(aiRow);

  const aiScore = reviewed ? getScore(aiRow) : 0;
  const pendingScore = guessPendingScore(mentions);
  const score = reviewed ? aiScore : pendingScore;

  const decision = reviewed ? getDecision(aiRow, score) : "review_pending";

  // Only hide clear AI trash. Do not hide unreviewed companies.
  if (reviewed && isTrashDecision(decision)) continue;
  if (reviewed && score <= 0) continue;

  const mentionCount =
    Number(aiRow?.mentionCount || aiRow?.mentionsCount || aiRow?.mentions || 0) ||
    mentions.length ||
    1;

  const latest = latestTime(mentions) || Date.now();

  dashboardRows.push({
    ...(aiRow || {}),
    companyName,
    decision,
    decisionLabel: readableDecision(decision),
    score,
    aiIntentScore: score,
    confidence: reviewed ? getConfidence(aiRow) : 0,
    reviewStatus: reviewed ? "reviewed" : "pending",
    mentionCount,
    sourceName: sourceName(primaryMention),
    source: sourceName(primaryMention),
    sourceUrl: sourceUrl(primaryMention),
    sourceType: clean(primaryMention.sourceType || primaryMention.type || ""),
    signal: clean(primaryMention.signal || aiRow?.signal || "Public signal"),
    mentionTitle: clean(primaryMention.mentionTitle || primaryMention.title || ""),
    capturedAt: new Date(latest).toISOString(),
    icpFit: reviewed
      ? pickText(
          aiRow,
          ["icpFit", "buyerNeed", "fitReason", "reason", "summary"],
          "Possible fit based on public hiring, event, growth, or market signals."
        )
      : "Awaiting review. This company appeared in the current signal scan.",
    whyNow: reviewed
      ? pickText(
          aiRow,
          ["whyNow", "why_now", "trigger", "signalReason", "reason"],
          "Recent public signal suggests the company may be worth reviewing."
        )
      : `Detected from ${sourceName(primaryMention)} in the current scan.`,
    nextAction: buildNextAction({
      reviewed,
      decision,
      score,
      source: sourceName(primaryMention),
      aiRow
    }),
    runId,
    runStartedAt
  });
}

dashboardRows.sort((a, b) => {
  const reviewedDiff =
    (a.reviewStatus === "reviewed" ? 1 : 0) -
    (b.reviewStatus === "reviewed" ? 1 : 0);

  if (reviewedDiff !== 0) return -reviewedDiff;

  const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
  if (scoreDiff !== 0) return scoreDiff;

  const mentionDiff = Number(b.mentionCount || 0) - Number(a.mentionCount || 0);
  if (mentionDiff !== 0) return mentionDiff;

  return Date.parse(b.capturedAt || "") - Date.parse(a.capturedAt || "");
});

await writeFile(OUT_JSON, JSON.stringify(dashboardRows, null, 2));
await writeFile(OUT_CSV, toCsv(dashboardRows));
await writeFile(RAW_COMPANY_MENTIONS, JSON.stringify(rawCompanyMentions, null, 2));

const reviewedVisible = dashboardRows.filter((row) => row.reviewStatus === "reviewed").length;
const pendingVisible = dashboardRows.filter((row) => row.reviewStatus === "pending").length;
const trashReviewed = aiRows.filter((row) => {
  const score = getScore(row);
  return score <= 0 || isTrashDecision(getDecision(row, score));
}).length;

console.log("Lead queue dataset built");
console.log(`Run ID: ${runId}`);
console.log("------------------------");
console.log(`Pre-clean rows: ${precleanRows.length}`);
console.log(`Unique accepted companies: ${mentionsByCompany.size}`);
console.log(`Reviewed companies saved: ${aiRows.length}`);
console.log(`Reviewed visible leads: ${reviewedVisible}`);
console.log(`Pending visible leads: ${pendingVisible}`);
console.log(`Reviewed hidden as trash: ${trashReviewed}`);
console.log(`Final lead queue rows: ${dashboardRows.length}`);
console.log(`Wrote ${OUT_JSON}`);
console.log(`Wrote ${OUT_CSV}`);
console.log(`Updated ${RAW_COMPANY_MENTIONS}`);
