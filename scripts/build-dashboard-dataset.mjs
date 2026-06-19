import fs from "node:fs";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const PRECLEAN_JSON = dataPath("real-source-mentions-preclean.json");
const REJECTED_JSON = dataPath("real-source-mentions-rejected-preclean.json");
const GEMINI_JSON = dataPath("ai-enriched-source-mentions.json");

const HYBRID_JSON = dataPath("hybrid-enriched-source-mentions.json");
const HYBRID_CSV = dataPath("hybrid-enriched-source-mentions.csv");

// This is what the dashboard already imports.
const DASHBOARD_JSON = dataPath("raw-company-mentions.json");

function cleanText(value = "") {
  return String(value)
    .replace(/[�]/g, "")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function text(row) {
  return [
    row.rawName,
    row.sourceType,
    row.sourceName,
    row.description,
    row.homepageText,
    row.careersText,
    row.stageHint,
    row.precleanReason,
  ]
    .filter(Boolean)
    .map(cleanText)
    .join(" ")
    .toLowerCase();
}

function hasAny(value, terms) {
  return terms.some((term) => value.includes(term));
}

function rowKey(row) {
  return [
    cleanText(row.id).toLowerCase(),
    cleanText(row.rawName).toLowerCase(),
    cleanText(row.sourceName).toLowerCase(),
    cleanText(row.sourceUrl || row.website || "").toLowerCase(),
  ].join("|");
}

function localScore(row) {
  const t = text(row);
  let score = 0;
  const signals = [];

  if (hasAny(t, ["account executive", "business development", "sdr", "bdr"])) {
    score += 35;
    signals.push("sales hiring");
  }

  if (hasAny(t, ["sales", "revenue", "revops", "commercial", "pipeline"])) {
    score += 28;
    signals.push("revenue/GTM signal");
  }

  if (hasAny(t, ["growth", "demand generation", "lead generation", "marketing"])) {
    score += 22;
    signals.push("growth or demand generation signal");
  }

  if (hasAny(t, ["partnership", "customer success", "go-to-market", "gtm"])) {
    score += 18;
    signals.push("commercial expansion signal");
  }

  if (hasAny(t, ["saas", "b2b", "software", "platform", "enterprise", "crm", "automation", "cloud", "security", "ai"])) {
    score += 14;
    signals.push("B2B/software/company fit");
  }

  if (hasAny(t, ["fintech", "payments", "ecommerce", "retail", "marketplace"])) {
    score += 10;
    signals.push("commercial market fit");
  }

  if (row.sourceType === "conference") {
    score += 12;
    signals.push("conference/exhibitor visibility");
  }

  if (row.sourceType === "accelerator" || row.sourceType === "startup_directory") {
    score += 10;
    signals.push("startup/product discovery signal");
  }

  if (row.sourceName?.includes("Adzuna") || row.sourceName?.includes("Jobicy")) {
    score += 8;
    signals.push("active hiring source");
  }

  if (hasAny(t, ["admin assistant", "clinical", "nurse", "data entry", "recruitment consultant", "staffing agency"])) {
    score = Math.min(score, 25);
    signals.push("possible noisy or low-fit role");
  }

  score = Math.max(0, Math.min(100, score));

  let stage = "low_intent";
  let fit = "low";

  if (score >= 85) {
    stage = "high_intent";
    fit = "high";
  } else if (score >= 65) {
    stage = "medium_intent";
    fit = "medium";
  } else if (score >= 40) {
    stage = "low_intent";
    fit = "medium";
  }

  const companyType = hasAny(t, ["saas", "software", "platform", "crm", "automation", "cloud", "security", "ai"])
    ? "b2b_software"
    : hasAny(t, ["fintech", "payments", "banking"])
      ? "fintech"
      : hasAny(t, ["ecommerce", "retail", "commerce", "marketplace"])
        ? "ecommerce"
        : "unknown";

  return {
    score,
    stage,
    fit,
    signals,
    companyType,
    isPotentialCustomer: score >= 40,
    isBadLead: score < 30,
    scoreReasoning:
      signals.length > 0
        ? `Local fallback score from detected signals: ${signals.join(", ")}.`
        : "Weak buying signal after pre-cleaning.",
    whyNow:
      score >= 65
        ? "Recent hiring, GTM language, or market visibility suggests the company may be investing in growth."
        : "Some activity exists, but the immediate outbound need is still weak.",
    recommendedBuyer:
      score >= 65
        ? "VP Sales, Head of Growth, Revenue Leader, Founder, GTM Lead"
        : "Founder, Operations Lead, Marketing Lead",
    outreachAngle:
      score >= 65
        ? "Position outbound support as a way to convert current growth signals into qualified meetings without adding internal SDR workload."
        : "Use a light discovery angle around whether they are planning outbound or appointment-setting support this quarter.",
  };
}

function categoryFromScore(score, isBadLead = false) {
  if (isBadLead) return "trash";
  if (score >= 85) return "high_intent";
  if (score >= 65) return "medium_intent";
  if (score >= 40) return "low_intent";
  return "trash";
}

function csvEscape(value) {
  if (value === undefined || value === null) return "";
  const str = Array.isArray(value) ? value.join("; ") : String(value);
  return `"${cleanText(str).replace(/"/g, '""')}"`;
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
    "stageHint",
    "agentConfidence",
    "expectedCategory",
    "expectedTrashReason",
    "aiGenerated",
    "aiProvider",
    "aiModel",
    "aiCompanyType",
    "aiIcpFit",
    "aiBuyingStage",
    "aiIntentScore",
    "aiSignals",
    "aiScoreReasoning",
    "aiWhyNow",
    "aiRecommendedBuyer",
    "aiOutreachAngle",
  ];

  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");

  fs.writeFileSync(path, csv);
}

if (!fs.existsSync(PRECLEAN_JSON)) {
  console.error(`Missing ${PRECLEAN_JSON}`);
  console.error("Run: node scripts/preclean-real-sources.mjs");
  process.exit(1);
}

const acceptedRows = JSON.parse(fs.readFileSync(PRECLEAN_JSON, "utf-8"));
const rejectedRows = fs.existsSync(REJECTED_JSON)
  ? JSON.parse(fs.readFileSync(REJECTED_JSON, "utf-8"))
  : [];

const geminiRows = fs.existsSync(GEMINI_JSON)
  ? JSON.parse(fs.readFileSync(GEMINI_JSON, "utf-8"))
  : [];

const geminiByKey = new Map();
for (const row of geminiRows) {
  geminiByKey.set(rowKey(row), row);
}

const hybridAccepted = acceptedRows.map((row) => {
  const gemini = geminiByKey.get(rowKey(row));

  if (gemini?.aiGenerated) {
    const score = Number(gemini.aiIntentScore || 0);
    const isBadLead = Boolean(gemini.aiIsBadLead);
    const category = categoryFromScore(score, isBadLead);

    return {
      ...row,
      rawName: cleanText(gemini.rawName || row.rawName),
      description: cleanText(gemini.aiScoreReasoning || gemini.description || row.description || ""),
      homepageText: cleanText(
        [
          row.homepageText,
          `AI why now: ${gemini.aiWhyNow || ""}`,
          `AI outreach angle: ${gemini.aiOutreachAngle || ""}`,
          `AI signals: ${Array.isArray(gemini.aiSignals) ? gemini.aiSignals.join(", ") : ""}`,
        ].join(" ")
      ),
      aiGenerated: true,
      aiProvider: gemini.aiProvider || "gemini",
      aiModel: gemini.aiModel || "",
      aiCompanyType: gemini.aiCompanyType || "unknown",
      aiIsPotentialCustomer: gemini.aiIsPotentialCustomer,
      aiIsBadLead: gemini.aiIsBadLead,
      aiBadLeadReason: gemini.aiBadLeadReason || "",
      aiIcpFit: gemini.aiIcpFit || "",
      aiBuyingStage: gemini.aiBuyingStage || "",
      aiSignals: gemini.aiSignals || [],
      aiIntentScore: score,
      aiScoreReasoning: gemini.aiScoreReasoning || "",
      aiWhyNow: gemini.aiWhyNow || "",
      aiRecommendedBuyer: gemini.aiRecommendedBuyer || "",
      aiOutreachAngle: gemini.aiOutreachAngle || "",
      agentConfidence: Math.max(Number(row.agentConfidence || 0), score / 100),
      expectedCategory: category,
      expectedTrashReason: category === "trash" ? gemini.aiBadLeadReason || "AI rejected this row." : "",
    };
  }

  const local = localScore(row);
  const category = categoryFromScore(local.score, local.isBadLead);

  return {
    ...row,
    description: local.scoreReasoning,
    homepageText: cleanText(
      [
        row.homepageText,
        `Local why now: ${local.whyNow}`,
        `Local outreach angle: ${local.outreachAngle}`,
        `Local signals: ${local.signals.join(", ")}`,
      ].join(" ")
    ),
    aiGenerated: false,
    aiProvider: "local-rules-fallback",
    aiModel: "deterministic-v1",
    aiCompanyType: local.companyType,
    aiIsPotentialCustomer: local.isPotentialCustomer,
    aiIsBadLead: local.isBadLead,
    aiBadLeadReason: local.isBadLead ? "Low deterministic fallback score." : "",
    aiIcpFit: local.fit,
    aiBuyingStage: local.stage,
    aiSignals: local.signals,
    aiIntentScore: local.score,
    aiScoreReasoning: local.scoreReasoning,
    aiWhyNow: local.whyNow,
    aiRecommendedBuyer: local.recommendedBuyer,
    aiOutreachAngle: local.outreachAngle,
    agentConfidence: Math.max(Number(row.agentConfidence || 0), local.score / 100),
    expectedCategory: category,
    expectedTrashReason: category === "trash" ? "Low deterministic fallback score." : "",
  };
});

const hybridRejected = rejectedRows.map((row) => ({
  ...row,
  aiGenerated: false,
  aiProvider: "preclean-rules",
  aiModel: "deterministic-v1",
  aiCompanyType: "unknown",
  aiIsPotentialCustomer: false,
  aiIsBadLead: true,
  aiBadLeadReason: row.precleanReason || "Rejected during pre-cleaning.",
  aiIcpFit: "low",
  aiBuyingStage: "not_relevant",
  aiSignals: [],
  aiIntentScore: 0,
  aiScoreReasoning: `Rejected during pre-cleaning: ${row.precleanReason || "obvious noise"}.`,
  aiWhyNow: "",
  aiRecommendedBuyer: "",
  aiOutreachAngle: "",
  agentConfidence: 0.1,
  expectedCategory: "trash",
  expectedTrashReason: row.precleanReason || "Rejected during pre-cleaning.",
}));

const finalRows = [...hybridAccepted, ...hybridRejected].sort(
  (a, b) => Number(b.aiIntentScore || 0) - Number(a.aiIntentScore || 0)
);

fs.writeFileSync(HYBRID_JSON, JSON.stringify(finalRows, null, 2));
fs.writeFileSync(DASHBOARD_JSON, JSON.stringify(finalRows, null, 2));
writeCsv(finalRows, HYBRID_CSV);

console.log("Hybrid dashboard dataset built");
console.log("------------------------------");
console.log(`Pre-clean accepted rows: ${acceptedRows.length}`);
console.log(`Pre-clean rejected rows: ${rejectedRows.length}`);
console.log(`Gemini rows used: ${finalRows.filter((row) => row.aiGenerated).length}`);
console.log(`Local fallback rows: ${finalRows.filter((row) => row.aiProvider === "local-rules-fallback").length}`);
console.log(`Trash rows: ${finalRows.filter((row) => row.expectedCategory === "trash").length}`);
console.log(`Final dashboard rows: ${finalRows.length}`);
console.log(`Wrote ${HYBRID_JSON}`);
console.log(`Wrote ${HYBRID_CSV}`);
console.log(`Updated ${DASHBOARD_JSON}`);
