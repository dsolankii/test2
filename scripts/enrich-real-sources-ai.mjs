import fs from "node:fs";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

dotenv.config({ path: ".env.local", quiet: true });

const RAW_INPUT_JSON = dataPath("real-source-mentions.json");
const PRECLEAN_INPUT_JSON = dataPath("real-source-mentions-preclean.json");
const OUTPUT_JSON = dataPath("ai-enriched-source-mentions.json");
const OUTPUT_CSV = dataPath("ai-enriched-source-mentions.csv");

const AI_LIMIT = 5;
const AI_DELAY_MS = 12000;

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

const inputJson = fs.existsSync(PRECLEAN_INPUT_JSON)
  ? PRECLEAN_INPUT_JSON
  : RAW_INPUT_JSON;

if (!fs.existsSync(inputJson)) {
  console.error(`Missing input file: ${inputJson}`);
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: aiApiKey,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function getText(row) {
  return [
    row.rawName,
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

function sourcePriority(row) {
  const text = getText(row);

  let score = 0;

  if (text.includes("account executive")) score += 35;
  if (text.includes("business development")) score += 35;
  if (text.includes("sdr") || text.includes("bdr")) score += 35;
  if (text.includes("sales")) score += 28;
  if (text.includes("revenue")) score += 25;
  if (text.includes("growth")) score += 22;
  if (text.includes("demand generation")) score += 22;
  if (text.includes("marketing")) score += 18;
  if (text.includes("partnership")) score += 18;
  if (text.includes("customer success")) score += 16;
  if (text.includes("gtm") || text.includes("go-to-market")) score += 16;
  if (text.includes("saas")) score += 12;
  if (text.includes("b2b")) score += 12;
  if (row.sourceType === "conference") score += 8;
  if (row.sourceName?.includes("Adzuna")) score += 8;
  if (row.sourceName?.includes("Remote OK")) score += 6;

  return score;
}

function isQuotaError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const status = Number(error?.status || 0);

  return (
    status === 429 ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("exceeded your current quota")
  );
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("AI did not return valid JSON.");
    }
    return JSON.parse(match[0]);
  }
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

function savePartial(rows) {
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(rows, null, 2));
  writeCsv(rows, OUTPUT_CSV);
}

async function generateAiJson(prompt) {
  const response = await ai.models.generateContent({
    model: aiModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  return safeJsonParse(response.text || "{}");
}

function buildPrompt(row) {
  return `
You are an AI sales intelligence analyst for a company that sells outbound sales support and appointment-setting services.

Analyze this raw company/source mention and decide whether it is a good potential customer.

Raw company mention:
Company name: ${row.rawName}
Website: ${row.website || "unknown"}
Source type: ${row.sourceType}
Source name: ${row.sourceName}
Source URL: ${row.sourceUrl}
Description: ${row.description || ""}
Homepage/source text: ${row.homepageText || ""}
Careers/job text: ${row.careersText || ""}

Return only valid JSON in this exact shape:

{
  "companyName": "string",
  "cleanCompanyName": "string",
  "companyType": "b2b_saas | b2b_software | ecommerce | fintech | healthcare | agency | recruiting_staffing | consumer | enterprise | unknown",
  "isPotentialCustomer": true,
  "isBadLead": false,
  "badLeadReason": "",
  "icpFit": "high | medium | low",
  "buyingStage": "high_intent | medium_intent | low_intent | not_relevant",
  "signals": ["short signal label"],
  "intentScore": 0,
  "scoreReasoning": "short explanation of why this score was assigned",
  "whyNow": "why now is a good time to contact them",
  "recommendedBuyer": "best buyer roles to contact",
  "outreachAngle": "personalized outbound angle"
}

Scoring rules:
- 85-100: B2B company with sales, revenue, GTM, growth, partnerships, demand gen, or customer success hiring.
- 70-84: B2B/company growth signal, marketing/growth hiring, conference/sponsor activity, or strong GTM language.
- 45-69: Possible company fit but weak immediate buying signal.
- 1-44: Weak fit, consumer/local/admin/medical/non-GTM signal.
- 0: agency, recruiting/staffing provider, irrelevant company, dead/unclear source, or not a potential customer.

Important:
- Recruiting/staffing agencies are bad leads because they are service providers, not buyers.
- Admin, clinical, medical, data-entry, and generic assistant roles are low intent.
- Healthcare companies can be potential customers only if the role/source indicates sales, growth, marketing, revenue, partnerships, or commercial expansion.
- Conference presence is a useful GTM visibility signal but not enough alone for a very high score.
- Be strict. Do not over-score weak leads.
`;
}

async function main() {
  const allRows = JSON.parse(fs.readFileSync(inputJson, "utf-8"));

  const selectedRows = [...allRows]
    .sort((a, b) => sourcePriority(b) - sourcePriority(a))
    .slice(0, AI_LIMIT);

  const enrichedRows = [];

  console.log(`AI provider: ${aiProvider}`);
  console.log(`Model: ${aiModel}`);
  console.log(`Input file: ${inputJson}`);
  console.log(`Rows selected for enrichment: ${selectedRows.length}`);
  console.log(`Delay: ${AI_DELAY_MS}ms`);
  console.log("Fallback: disabled");
  console.log("Retry: disabled");
  console.log("");

  for (let index = 0; index < selectedRows.length; index++) {
    const row = selectedRows[index];

    console.log(`${index + 1}/${selectedRows.length}: ${row.rawName} (${row.sourceName})`);

    try {
      const aiResult = await generateAiJson(buildPrompt(row));

      const enriched = {
        ...row,
        rawName: cleanText(aiResult.cleanCompanyName || aiResult.companyName || row.rawName),
        description: cleanText(aiResult.scoreReasoning || row.description || ""),
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
        aiIntentScore: Number(aiResult.intentScore || 0),
        aiScoreReasoning: aiResult.scoreReasoning || "",
        aiWhyNow: aiResult.whyNow || "",
        aiRecommendedBuyer: aiResult.recommendedBuyer || "",
        aiOutreachAngle: aiResult.outreachAngle || "",
      };

      enrichedRows.push(enriched);
      savePartial(enrichedRows);

      console.log(`  → score ${enriched.aiIntentScore} | ${enriched.aiBuyingStage} | ${enriched.aiIcpFit}`);
    } catch (error) {
      if (isQuotaError(error)) {
        console.log("  → quota/rate limit hit. Stopping and saving partial results.");
        savePartial(enrichedRows);
        break;
      }

      console.log(`  → failed: ${String(error?.message || error).slice(0, 180)}`);
      savePartial(enrichedRows);
    }

    if (index < selectedRows.length - 1) {
      console.log(`  waiting ${AI_DELAY_MS / 1000}s...`);
      await sleep(AI_DELAY_MS);
    }
  }

  savePartial(enrichedRows);

  const accepted = enrichedRows.filter((row) => row.aiIsPotentialCustomer && !row.aiIsBadLead);
  const rejected = enrichedRows.filter((row) => row.aiIsBadLead || !row.aiIsPotentialCustomer);

  console.log("");
  console.log("AI enrichment finished");
  console.log("----------------------");
  console.log(`Rows enriched/saved: ${enrichedRows.length}`);
  console.log(`AI accepted: ${accepted.length}`);
  console.log(`AI rejected / low-fit: ${rejected.length}`);
  console.log(`Wrote ${OUTPUT_JSON}`);
  console.log(`Wrote ${OUTPUT_CSV}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
