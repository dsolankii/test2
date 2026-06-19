import fs from "node:fs";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

dotenv.config({ path: ".env.local", quiet: true });

const INPUT_JSON = dataPath("real-source-mentions.json");
const OUTPUT_JSON = dataPath("gemini-test-one-row.json");

const aiProvider = process.env.AI_PROVIDER || "gemini";
const aiApiKey = process.env.AI_API_KEY;
const primaryModel = process.env.AI_MODEL || "gemini-2.5-flash-lite";

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
  process.exit(1);
}

const fallbackModels = String(
  process.env.AI_FALLBACK_MODELS ||
    `${primaryModel},gemini-2.5-flash,gemini-2.0-flash-lite,gemini-2.0-flash`
)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

const rows = JSON.parse(fs.readFileSync(INPUT_JSON, "utf-8"));

const positiveKeywords = [
  "sales",
  "business development",
  "account executive",
  "customer success",
  "growth",
  "marketing",
  "partnerships",
  "revenue",
  "lead generation",
  "demand generation",
  "go-to-market",
  "gtm",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textForRow(row) {
  return [
    row.rawName,
    row.description,
    row.homepageText,
    row.careersText,
    row.sourceName,
    row.stageHint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isRetryableGeminiError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const status = Number(error?.status || 0);

  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes("high demand") ||
    message.includes("unavailable") ||
    message.includes("quota") ||
    message.includes("rate")
  );
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Gemini did not return valid JSON.");
    }
    return JSON.parse(match[0]);
  }
}

async function generateWithRetry({ ai, prompt }) {
  let lastError;

  for (const model of fallbackModels) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Trying model: ${model} | attempt ${attempt}/3`);

        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        });

        const text = response.text || "{}";
        const parsed = safeJsonParse(text);

        return {
          model,
          parsed,
        };
      } catch (error) {
        lastError = error;

        const message = String(error?.message || error);
        console.log(`Gemini call failed: ${message.slice(0, 220)}`);

        if (!isRetryableGeminiError(error)) {
          throw error;
        }

        const waitMs = attempt * 5000;
        console.log(`Waiting ${waitMs / 1000}s before retry...`);
        await sleep(waitMs);
      }
    }

    console.log(`Switching away from overloaded model: ${model}`);
  }

  throw lastError;
}

const row =
  rows.find((item) =>
    positiveKeywords.some((keyword) => textForRow(item).includes(keyword))
  ) || rows[0];

const ai = new GoogleGenAI({
  apiKey: aiApiKey,
});

const prompt = `
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
- Conference presence is a useful GTM visibility signal but not enough alone for a very high score.
- Be strict. Do not over-score weak leads.
`;

const result = await generateWithRetry({
  ai,
  prompt,
});

const output = {
  aiProvider,
  modelUsed: result.model,
  input: row,
  ai: result.parsed,
};

fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2));

console.log("");
console.log("AI one-row test successful");
console.log("--------------------------");
console.log(`Provider: ${aiProvider}`);
console.log(`Model used: ${result.model}`);
console.log(`Input company: ${row.rawName}`);
console.log(`Source: ${row.sourceName}`);
console.log("");
console.log("AI result:");
console.log(JSON.stringify(result.parsed, null, 2));
console.log("");
console.log(`Saved: ${OUTPUT_JSON}`);
