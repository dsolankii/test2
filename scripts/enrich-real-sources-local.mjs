import fs from "node:fs";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const INPUT_JSON = dataPath("real-source-mentions-preclean.json");
const OUTPUT_JSON = dataPath("ai-enriched-source-mentions.json");
const OUTPUT_CSV = dataPath("ai-enriched-source-mentions.csv");

function cleanText(value = "") {
  return String(value)
    .replace(/\u00e2\u0080\u0094/g, "—")
    .replace(/\u00e2\u0080\u0093/g, "–")
    .replace(/\u00e2\u0080\u0099/g, "'")
    .replace(/\u00c2\u00a3/g, "£")
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
  ]
    .filter(Boolean)
    .map(cleanText)
    .join(" ")
    .toLowerCase();
}

function includesAny(value, terms) {
  return terms.some((term) => value.includes(term));
}

function scoreRow(row) {
  const t = text(row);

  let score = 0;
  const signals = [];

  if (includesAny(t, ["account executive", "business development", "sdr", "bdr"])) {
    score += 35;
    signals.push("sales hiring");
  }

  if (includesAny(t, ["sales", "revenue", "revops", "commercial"])) {
    score += 28;
    signals.push("revenue/GTM signal");
  }

  if (includesAny(t, ["growth", "demand generation", "lead generation", "marketing"])) {
    score += 22;
    signals.push("growth or demand generation signal");
  }

  if (includesAny(t, ["partnership", "customer success", "go-to-market", "gtm"])) {
    score += 18;
    signals.push("commercial expansion signal");
  }

  if (includesAny(t, ["saas", "b2b", "software", "platform", "enterprise", "crm", "automation"])) {
    score += 14;
    signals.push("B2B/software fit");
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

  if (includesAny(t, ["recruiting agency", "staffing agency", "admin assistant", "clinical", "nurse", "data entry"])) {
    score = Math.min(score, 25);
    signals.push("possible low-fit/noisy role");
  }

  score = Math.max(0, Math.min(100, score));

  let buyingStage = "low_intent";
  let icpFit = "low";

  if (score >= 85) {
    buyingStage = "high_intent";
    icpFit = "high";
  } else if (score >= 65) {
    buyingStage = "medium_intent";
    icpFit = "medium";
  } else if (score >= 40) {
    buyingStage = "low_intent";
    icpFit = "medium";
  }

  const companyType = includesAny(t, ["saas", "software", "platform", "crm", "automation"])
    ? "b2b_software"
    : includesAny(t, ["fintech", "payments", "banking"])
      ? "fintech"
      : includesAny(t, ["ecommerce", "retail", "commerce"])
        ? "ecommerce"
        : "unknown";

  const isPotentialCustomer = score >= 40;
  const isBadLead = score < 30;

  const scoreReasoning =
    signals.length > 0
      ? `Scored from detected signals: ${signals.join(", ")}.`
      : "Weak or unclear buying signal after pre-cleaning.";

  const whyNow =
    score >= 65
      ? "Recent hiring, GTM activity, or conference visibility suggests the company may be investing in growth and could need outbound support."
      : "There is some business activity, but the immediate need for outbound support is not yet strong.";

  const recommendedBuyer =
    score >= 65
      ? "VP Sales, Head of Growth, Revenue Leader, Founder, GTM Lead"
      : "Founder, Operations Lead, Marketing Lead";

  const outreachAngle =
    score >= 65
      ? "Lead with helping their team turn current growth signals into qualified meetings without adding more internal SDR workload."
      : "Lead with a light discovery angle around whether they are planning outbound or appointment-setting support this quarter.";

  return {
    score,
    buyingStage,
    icpFit,
    signals,
    companyType,
    isPotentialCustomer,
    isBadLead,
    scoreReasoning,
    whyNow,
    recommendedBuyer,
    outreachAngle,
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
    "stageHint",
    "agentConfidence",
    "precleanDecision",
    "precleanReason",
    "aiGenerated",
    "aiProvider",
    "aiModel",
    "aiCompanyType",
    "aiIsPotentialCustomer",
    "aiIsBadLead",
    "aiBadLeadReason",
    "aiIcpFit",
    "aiBuyingStage",
    "aiSignals",
    "aiIntentScore",
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

if (!fs.existsSync(INPUT_JSON)) {
  console.error(`Missing ${INPUT_JSON}`);
  console.error("Run: node scripts/preclean-real-sources.mjs");
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(INPUT_JSON, "utf-8"));

const enriched = rows
  .map((row) => {
    const result = scoreRow(row);

    return {
      ...row,
      aiGenerated: false,
      aiProvider: "local-rules-fallback",
      aiModel: "deterministic-v1",
      aiCompanyType: result.companyType,
      aiIsPotentialCustomer: result.isPotentialCustomer,
      aiIsBadLead: result.isBadLead,
      aiBadLeadReason: result.isBadLead ? "Low deterministic score after pre-cleaning." : "",
      aiIcpFit: result.icpFit,
      aiBuyingStage: result.buyingStage,
      aiSignals: result.signals,
      aiIntentScore: result.score,
      aiScoreReasoning: result.scoreReasoning,
      aiWhyNow: result.whyNow,
      aiRecommendedBuyer: result.recommendedBuyer,
      aiOutreachAngle: result.outreachAngle,
    };
  })
  .sort((a, b) => b.aiIntentScore - a.aiIntentScore);

fs.writeFileSync(OUTPUT_JSON, JSON.stringify(enriched, null, 2));
writeCsv(enriched, OUTPUT_CSV);

console.log("Local enrichment complete");
console.log("-------------------------");
console.log(`Rows enriched: ${enriched.length}`);
console.log(`High intent: ${enriched.filter((row) => row.aiIntentScore >= 85).length}`);
console.log(`Medium intent: ${enriched.filter((row) => row.aiIntentScore >= 65 && row.aiIntentScore < 85).length}`);
console.log(`Low intent: ${enriched.filter((row) => row.aiIntentScore < 65).length}`);
console.log(`Wrote ${OUTPUT_JSON}`);
console.log(`Wrote ${OUTPUT_CSV}`);
