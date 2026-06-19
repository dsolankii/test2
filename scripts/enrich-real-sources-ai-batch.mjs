import fs from "node:fs";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

dotenv.config({ path: ".env.local", quiet: true });

const INPUT_JSON = dataPath("real-source-mentions-preclean.json");
const OUTPUT_JSON = dataPath("ai-enriched-source-mentions.json");
const OUTPUT_CSV = dataPath("ai-enriched-source-mentions.csv");

const BATCH_SIZE = 20;
const MAX_TEXT_CHARS_PER_ROW = 900;

const aiProvider = process.env.AI_PROVIDER || "gemini";
const aiApiKey = process.env.AI_API_KEY;
const aiModel = process.env.AI_MODEL || "gemini-2.5-flash-lite";

if (aiProvider !== "gemini") {
  console.error(`Unsupported AI_PROVIDER: ${aiProvider}`);
  console.error("Currently supported: gemini");
  process.exit(1);
}

if (!aiApiKey) {
  console.error("Missing AI_API_KEY in .env.local");
  process.exit(1);
}

if (!fs.existsSync(INPUT_JSON)) {
  console.error(`Missing ${INPUT_JSON}`);
  console.error("Run: node scripts/preclean-real-sources.mjs");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: aiApiKey,
});

function cleanText(value = "") {
  return String(value)
    .replace(/[�]/g, "")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rowKey(row) {
  return [
    cleanText(row.id).toLowerCase(),
    cleanText(row.rawName).toLowerCase(),
    cleanText(row.sourceName).toLowerCase(),
    cleanText(row.sourceUrl || row.website || "").toLowerCase(),
  ].join("|");
}

function sourcePriority(row) {
  const text = [
    row.rawName,
    row.sourceName,
    row.sourceType,
    row.description,
    row.homepageText,
    row.careersText,
    row.stageHint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;

  if (text.includes("account executive")) score += 40;
  if (text.includes("business development")) score += 40;
  if (text.includes("sdr") || text.includes("bdr")) score += 40;
  if (text.includes("sales")) score += 32;
  if (text.includes("revenue")) score += 30;
  if (text.includes("revops")) score += 30;
  if (text.includes("go-to-market") || text.includes("gtm")) score += 28;
  if (text.includes("growth")) score += 24;
  if (text.includes("demand generation")) score += 24;
  if (text.includes("lead generation")) score += 24;
  if (text.includes("marketing")) score += 18;
  if (text.includes("partnership")) score += 18;
  if (text.includes("customer success")) score += 16;
  if (text.includes("saas")) score += 14;
  if (text.includes("b2b")) score += 14;
  if (text.includes("software")) score += 12;
  if (text.includes("platform")) score += 12;
  if (row.sourceType === "conference") score += 8;
  if (row.sourceName?.includes("Adzuna")) score += 8;
  if (row.sourceName?.includes("Jobicy")) score += 8;

  return score;
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

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\[[\s\S]*\]/);
    if (!match) {
      throw new Error("AI did not return a JSON array.");
    }
    return JSON.parse(match[0]);
  }
}

function compactRowForAi(row) {
  const combinedText = [
    row.description,
    row.homepageText,
    row.careersText,
    row.stageHint,
  ]
    .filter(Boolean)
    .map(cleanText)
    .join(" ")
    .slice(0, MAX_TEXT_CHARS_PER_ROW);

  return {
    sourceRowId: rowKey(row),
    companyName: cleanText(row.rawName),
    website: cleanText(row.website || ""),
    sourceType: cleanText(row.sourceType || ""),
    sourceName: cleanText(row.sourceName || ""),
    sourceUrl: cleanText(row.sourceUrl || ""),
    text: combinedText,
  };
}

function buildPrompt(rows) {
  const compactRows = rows.map(compactRowForAi);

  return `
You are an AI sales intelligence analyst for an outbound sales support and appointment-setting company.

You will receive ${compactRows.length} raw company/source mentions.

For EACH company, clean, classify, qualify, and score whether it is a good potential customer for outbound sales / appointment-setting support.

Return ONLY valid JSON array.
Return exactly one object per input row.
Do not use markdown.
Do not add commentary.

Input rows:
${JSON.stringify(compactRows, null, 2)}

Return JSON array with this exact object shape for every row:

[
  {
    "sourceRowId": "must exactly match input sourceRowId",
    "companyName": "original or best company name",
    "cleanCompanyName": "clean company name",
    "companyType": "b2b_saas | b2b_software | ecommerce | fintech | healthcare | agency | recruiting_staffing | consumer | enterprise | unknown",
    "isPotentialCustomer": true,
    "isBadLead": false,
    "badLeadReason": "",
    "icpFit": "high | medium | low",
    "buyingStage": "high_intent | medium_intent | low_intent | not_relevant",
    "signals": ["short signal label"],
    "intentScore": 0,
    "scoreReasoning": "short explanation",
    "whyNow": "why now is a good time to contact them",
    "recommendedBuyer": "best buyer roles",
    "outreachAngle": "personalized outbound angle"
  }
]

Scoring rules:
- 85-100: B2B company with strong sales, SDR, AE, revenue, GTM, demand gen, growth, partnerships, or customer success hiring.
- 70-84: B2B/company growth signal, marketing/growth hiring, conference/sponsor activity, or strong commercial language.
- 45-69: Possible fit but weak immediate buying signal.
- 1-44: Weak fit, consumer/local/admin/medical/non-GTM signal.
- 0: agency, recruiting/staffing provider, irrelevant, unclear, or not a potential customer.

Important:
- Recruiting/staffing agencies are bad leads because they are service providers, not buyers.
- Admin, clinical, medical, data-entry, and generic assistant roles are low intent.
- Healthcare can be potential customer only when there is sales/growth/marketing/revenue/partnership/commercial expansion signal.
- Conference presence is useful but should not be 90+ by itself.
- Be strict. Do not over-score weak leads.
`;
}

function normalizeAiResult(row, aiResult) {
  const score = Number(aiResult.intentScore || 0);
  const cleanName = cleanText(aiResult.cleanCompanyName || aiResult.companyName || row.rawName);

  return {
    ...row,
    rawName: cleanName,
    description: cleanText(aiResult.scoreReasoning || row.description || ""),
    homepageText: cleanText(
      [
        row.homepageText,
        `AI why now: ${aiResult.whyNow || ""}`,
        `AI outreach angle: ${aiResult.outreachAngle || ""}`,
        `AI signals: ${Array.isArray(aiResult.signals) ? aiResult.signals.join(", ") : ""}`,
      ].join(" ")
    ),
    aiGenerated: true,
    aiProvider,
    aiModel,
    aiCompanyType: aiResult.companyType || "unknown",
    aiIsPotentialCustomer: Boolean(aiResult.isPotentialCustomer),
    aiIsBadLead: Boolean(aiResult.isBadLead),
    aiBadLeadReason: aiResult.badLeadReason || "",
    aiIcpFit: aiResult.icpFit || "unknown",
    aiBuyingStage: aiResult.buyingStage || "unknown",
    aiSignals: Array.isArray(aiResult.signals) ? aiResult.signals : [],
    aiIntentScore: Number.isFinite(score) ? score : 0,
    aiScoreReasoning: aiResult.scoreReasoning || "",
    aiWhyNow: aiResult.whyNow || "",
    aiRecommendedBuyer: aiResult.recommendedBuyer || "",
    aiOutreachAngle: aiResult.outreachAngle || "",
  };
}

async function main() {
  const inputRows = JSON.parse(fs.readFileSync(INPUT_JSON, "utf-8"));
  const existingRows = fs.existsSync(OUTPUT_JSON)
    ? JSON.parse(fs.readFileSync(OUTPUT_JSON, "utf-8"))
    : [];

  const existingKeys = new Set(existingRows.map(rowKey));

  const remainingRows = inputRows
    .filter((row) => !existingKeys.has(rowKey(row)))
    .sort((a, b) => sourcePriority(b) - sourcePriority(a));

  const batchRows = remainingRows.slice(0, BATCH_SIZE);

  console.log("Batch AI enrichment");
  console.log("-------------------");
  console.log(`Provider: ${aiProvider}`);
  console.log(`Model: ${aiModel}`);
  console.log(`Input rows: ${inputRows.length}`);
  console.log(`Already Gemini enriched: ${existingRows.length}`);
  console.log(`Remaining rows: ${remainingRows.length}`);
  console.log(`Batch size this run: ${batchRows.length}`);
  console.log("");

  if (batchRows.length === 0) {
    console.log("Nothing left to enrich.");
    return;
  }

  const response = await ai.models.generateContent({
    model: aiModel,
    contents: buildPrompt(batchRows),
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const parsed = safeJsonParse(response.text || "[]");
  const resultArray = Array.isArray(parsed) ? parsed : parsed.results || parsed.companies || [];

  if (!Array.isArray(resultArray)) {
    throw new Error("AI response was not an array.");
  }

  const resultById = new Map();
  for (const item of resultArray) {
    if (item?.sourceRowId) {
      resultById.set(String(item.sourceRowId), item);
    }
  }

  const newlyEnriched = [];

  for (const row of batchRows) {
    const key = rowKey(row);
    const aiResult = resultById.get(key);

    if (!aiResult) {
      console.log(`Missing AI result for: ${row.rawName}`);
      continue;
    }

    const enriched = normalizeAiResult(row, aiResult);
    newlyEnriched.push(enriched);

    console.log(
      `${enriched.rawName} → ${enriched.aiIntentScore} | ${enriched.aiBuyingStage} | ${enriched.aiIcpFit}`
    );
  }

  const finalRows = [...existingRows, ...newlyEnriched];

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(finalRows, null, 2));
  writeCsv(finalRows, OUTPUT_CSV);

  console.log("");
  console.log("Batch AI enrichment complete");
  console.log("----------------------------");
  console.log(`Newly enriched: ${newlyEnriched.length}`);
  console.log(`Total Gemini enriched saved: ${finalRows.length}`);
  console.log(`Wrote ${OUTPUT_JSON}`);
  console.log(`Wrote ${OUTPUT_CSV}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
