import fs from "node:fs";
import dotenv from "dotenv";
import { jsonrepair } from "jsonrepair";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

dotenv.config({ path: ".env.local" });
dotenv.config();

const INPUT_JSON = dataPath("real-source-mentions-preclean.json");
const OUTPUT_JSON = dataPath("ai-enriched-company-leads.json");
const OUTPUT_CSV = dataPath("ai-enriched-company-leads.csv");
const RAW_RESPONSE_FILE = dataPath("ai-company-batch-last-raw-response.txt");

const BATCH_SIZE = Number(process.env.AI_BATCH_SIZE || 50);
const AI_SUB_BATCH_SIZE = Number(process.env.AI_SUB_BATCH_SIZE || 10);
const MAX_EVIDENCE_ROWS_PER_COMPANY = Number(process.env.MAX_EVIDENCE_ROWS_PER_COMPANY || 5);
const MAX_EVIDENCE_CHARS_PER_ROW = Number(process.env.MAX_EVIDENCE_CHARS_PER_ROW || 650);

const aiProvider = process.env.AI_PROVIDER || "gemini";
const aiApiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY;
const aiModel = process.env.AI_MODEL || "gemini-2.5-flash-lite";

if (aiProvider !== "gemini") {
  throw new Error(`Unsupported AI_PROVIDER: ${aiProvider}. This script currently supports gemini.`);
}

if (!aiApiKey) {
  throw new Error("Missing AI_API_KEY / GEMINI_API_KEY in env.");
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function cleanText(value = "") {
  return String(value ?? "")
    .replace(/[�]/g, "")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompanyName(name = "") {
  return cleanText(name)
    .toLowerCase()
    .replace(/\b(inc|inc\.|llc|ltd|ltd\.|corp|corp\.|corporation|company|co|co\.|limited|plc|gmbh|sa|ag)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyKeyFromName(name = "") {
  return normalizeCompanyName(name) || cleanText(name).toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function getCompanyName(row) {
  return cleanText(
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
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace("%", "").trim());
  return Number.isFinite(number) ? number : null;
}

function clampScore(value) {
  const number = toNumber(value);
  if (number === null) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function unique(values) {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

function compactRowEvidence(row) {
  const text = [
    row.description,
    row.homepageText,
    row.careersText,
    row.stageHint,
    row.precleanReason,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" | ");

  return {
    sourceName: cleanText(row.sourceName || ""),
    sourceType: cleanText(row.sourceType || ""),
    sourceUrl: cleanText(row.sourceUrl || row.website || ""),
    lastActivityDate: cleanText(row.lastActivityDate || ""),
    country: cleanText(row.country || ""),
    titleOrName: getCompanyName(row),
    evidenceText: text.slice(0, MAX_EVIDENCE_CHARS_PER_ROW),
  };
}

function groupCompanies(rows) {
  const map = new Map();

  for (const row of rows) {
    const name = getCompanyName(row);
    const key = cleanText(row.companyKey) || companyKeyFromName(name);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        companyKey: key,
        companyName: name,
        rawNames: [],
        websites: [],
        sourceNames: [],
        sourceTypes: [],
        sourceUrls: [],
        countries: [],
        latestActivityDate: "",
        mentionCount: 0,
        rows: [],
      });
    }

    const company = map.get(key);
    company.rawNames.push(name);
    company.websites.push(row.website || "");
    company.sourceNames.push(row.sourceName || "");
    company.sourceTypes.push(row.sourceType || "");
    company.sourceUrls.push(row.sourceUrl || row.website || "");
    company.countries.push(row.country || "");
    company.mentionCount += 1;
    company.rows.push(row);

    const date = cleanText(row.lastActivityDate || "");
    if (date && date > company.latestActivityDate) company.latestActivityDate = date;
  }

  return Array.from(map.values()).map((company) => ({
    ...company,
    rawNames: unique(company.rawNames),
    websites: unique(company.websites),
    sourceNames: unique(company.sourceNames),
    sourceTypes: unique(company.sourceTypes),
    sourceUrls: unique(company.sourceUrls),
    countries: unique(company.countries),
    evidenceRows: company.rows.slice(0, MAX_EVIDENCE_ROWS_PER_COMPANY).map(compactRowEvidence),
  }));
}

function safeJsonParse(text) {
  const raw = String(text || "").trim();
  fs.writeFileSync(RAW_RESPONSE_FILE, raw);

  const candidates = [raw];
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) candidates.push(arrayMatch[0]);

  for (const candidate of candidates) {
    const cleaned = candidate
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch {}

    try {
      return JSON.parse(jsonrepair(cleaned));
    } catch {}
  }

  throw new Error(`AI returned malformed JSON. Saved raw response to ${RAW_RESPONSE_FILE}`);
}

function extractLlmScore(result) {
  const direct = clampScore(
    result.intentScore ??
      result.aiIntentScore ??
      result.score ??
      result.leadScore ??
      result.aiScore
  );

  if (direct !== null) return { value: direct, source: "direct" };

  const breakdown = result.scoreBreakdown && typeof result.scoreBreakdown === "object" ? result.scoreBreakdown : null;

  if (breakdown) {
    const parts = [
      breakdown.icpFit,
      breakdown.outboundNeed,
      breakdown.growthTrigger,
      breakdown.evidenceQuality,
      breakdown.urgency,
      breakdown.buyerClarity,
      breakdown.negativePenalty,
    ];

    const numbers = parts.map(toNumber).filter((number) => number !== null);

    if (numbers.length >= 4) {
      const sum = numbers.reduce((acc, number) => acc + number, 0);
      return {
        value: Math.max(0, Math.min(100, Math.round(sum))),
        source: "scoreBreakdown",
      };
    }
  }

  return { value: null, source: "missing" };
}

function extractConfidence(result) {
  return clampScore(
    result.confidence ??
      result.aiConfidence ??
      result.confidenceScore ??
      result.aiConfidenceScore
  );
}

function validateAiResult(result, inputCompany) {
  if (!result || typeof result !== "object") return "result is not an object";

  const score = extractLlmScore(result);
  const confidence = extractConfidence(result);
  const decision = cleanText(result.decision || result.aiDecision || result.buyingStage || result.aiBuyingStage);
  const reasoning = cleanText(result.scoreReasoning || result.aiScoreReasoning || result.badLeadReason || result.confidenceReason);
  const entityType = cleanText(result.entityType || result.aiEntityType);
  const outputName = cleanText(result.cleanCompanyName || result.companyName || result.rawName || "");

  if (score.value === null) return "missing numeric LLM score";
  if (confidence === null) return "missing numeric confidence";
  if (!decision) return "missing decision";
  if (!entityType) return "missing entityType";
  if (!reasoning) return "missing reasoning";
  if (!outputName) return "missing company name";

  return "";
}

function calibrateDecision({
  score,
  confidence,
  entityType,
  companyType,
  isRealCompany,
  isPotentialCustomer,
  isBadLead,
  icpFit,
  buyerNeed,
  salesMotion,
}) {
  const entity = cleanText(entityType).toLowerCase();
  const type = cleanText(companyType).toLowerCase();
  const icp = cleanText(icpFit).toLowerCase();
  const need = cleanText(buyerNeed).toLowerCase();
  const motion = cleanText(salesMotion).toLowerCase();

  const isNonBuyerEntity =
    !isRealCompany ||
    entity === "event_or_conference_label" ||
    entity === "person_or_role" ||
    entity === "job_board_or_staffing";

  const isLikelyVendorOrCompetitor =
    entity === "vendor_or_agency" ||
    type === "agency" ||
    type === "recruiting_staffing" ||
    need === "none";

  if (isBadLead || isNonBuyerEntity) {
    return {
      decision: "trash",
      buyingStage: "not_relevant",
      isPotentialCustomer: false,
      isBadLead: true,
    };
  }

  if (isLikelyVendorOrCompetitor && score < 85) {
    return {
      decision: "not_relevant",
      buyingStage: "not_relevant",
      isPotentialCustomer: false,
      isBadLead: false,
    };
  }

  if (!isPotentialCustomer && score < 70) {
    return {
      decision: "research_more",
      buyingStage: "research_more",
      isPotentialCustomer: false,
      isBadLead: false,
    };
  }

  if (
    score >= 85 &&
    confidence >= 70 &&
    ["high", "medium"].includes(icp) &&
    ["pipeline_generation", "appointment_setting", "outbound_sales", "customer_acquisition", "partnerships"].includes(need) &&
    ["b2b_outbound", "b2b_inbound", "partner_channel"].includes(motion)
  ) {
    return {
      decision: "hot_lead",
      buyingStage: "high_intent",
      isPotentialCustomer: true,
      isBadLead: false,
    };
  }

  if (score >= 70 && confidence >= 55 && ["high", "medium"].includes(icp)) {
    return {
      decision: "warm_lead",
      buyingStage: score >= 80 ? "medium_intent" : "low_intent",
      isPotentialCustomer: true,
      isBadLead: false,
    };
  }

  if (score >= 50) {
    return {
      decision: "nurture",
      buyingStage: "low_intent",
      isPotentialCustomer: true,
      isBadLead: false,
    };
  }

  if (score >= 30) {
    return {
      decision: "research_more",
      buyingStage: "research_more",
      isPotentialCustomer: false,
      isBadLead: false,
    };
  }

  return {
    decision: "not_relevant",
    buyingStage: "not_relevant",
    isPotentialCustomer: false,
    isBadLead: false,
  };
}

function normalizeResult(result, inputCompany) {
  const scoreInfo = extractLlmScore(result);
  const confidence = extractConfidence(result);

  if (scoreInfo.value === null) {
    throw new Error(`Missing LLM score for ${inputCompany.companyName}`);
  }

  if (confidence === null) {
    throw new Error(`Missing LLM confidence for ${inputCompany.companyName}`);
  }

  const signals = Array.isArray(result.signals) ? result.signals : [];
  const scoreBreakdown =
    result.scoreBreakdown && typeof result.scoreBreakdown === "object"
      ? result.scoreBreakdown
      : {};

  const normalizedSignals = signals.map((signal) => {
    if (typeof signal === "string") {
      return {
        type: "unknown",
        strength: "medium",
        evidence: signal,
        sourceName: "",
      };
    }

    return {
      type: cleanText(signal.type || "unknown"),
      strength: cleanText(signal.strength || "medium"),
      evidence: cleanText(signal.evidence || ""),
      sourceName: cleanText(signal.sourceName || signal.source || ""),
    };
  });

  const score = scoreInfo.value;
  const entityType = cleanText(result.entityType || result.aiEntityType || "unknown");
  const companyType = cleanText(result.companyType || result.aiCompanyType || "unknown");
  const icpFit = cleanText(result.icpFit || result.aiIcpFit || "low");
  const buyerNeed = cleanText(result.buyerNeed || result.aiBuyerNeed || "unknown");
  const salesMotion = cleanText(result.salesMotion || result.aiSalesMotion || "unknown");
  const isRealCompany = Boolean(result.isRealCompany ?? result.aiIsRealCompany);
  const rawIsPotentialCustomer = Boolean(result.isPotentialCustomer ?? result.aiIsPotentialCustomer);
  const rawIsBadLead = Boolean(result.isBadLead ?? result.aiIsBadLead);

  const calibrated = calibrateDecision({
    score,
    confidence,
    entityType,
    companyType,
    isRealCompany,
    isPotentialCustomer: rawIsPotentialCustomer,
    isBadLead: rawIsBadLead,
    icpFit,
    buyerNeed,
    salesMotion,
  });

  return {
    id: `ai_company_${inputCompany.companyKey}`,
    companyKey: inputCompany.companyKey,
    companyName: inputCompany.companyName,
    rawName: result.cleanCompanyName || result.companyName || inputCompany.companyName,
    cleanCompanyName: result.cleanCompanyName || result.companyName || inputCompany.companyName,

    website: inputCompany.websites.join("; "),
    sourceName: inputCompany.sourceNames.join("; "),
    sourceType: inputCompany.sourceTypes.join("; "),
    sourceUrl: inputCompany.sourceUrls.join("; "),
    country: inputCompany.countries.join("; "),
    latestActivityDate: inputCompany.latestActivityDate,
    mentionCount: inputCompany.mentionCount,

    aiGenerated: true,
    aiProvider: "gemini",
    aiModel,
    aiReviewedAt: new Date().toISOString(),

    aiEntityType: entityType,
    aiIsRealCompany: isRealCompany,
    aiCompanyType: companyType,

    aiIsPotentialCustomer: calibrated.isPotentialCustomer,
    aiIsBadLead: calibrated.isBadLead,
    aiBadLeadReason: cleanText(result.badLeadReason || result.aiBadLeadReason || ""),

    aiIcpFit: icpFit,
    aiBuyingStage: calibrated.buyingStage,
    aiDecision: calibrated.decision,
    aiBuyerNeed: buyerNeed,
    aiSalesMotion: salesMotion,
    aiCompanySizeGuess: cleanText(result.companySizeGuess || result.aiCompanySizeGuess || "unknown"),

    aiSignals: normalizedSignals.map((signal) => `${signal.type}: ${signal.evidence}`).filter(Boolean),
    aiEvidenceSignals: normalizedSignals,

    aiIntentScore: score,
    aiScoreSource: scoreInfo.source,
    aiConfidence: confidence,
    aiConfidenceReason: cleanText(result.confidenceReason || result.aiConfidenceReason || ""),

    aiScoreBreakdown: {
      icpFit: toNumber(scoreBreakdown.icpFit) ?? 0,
      outboundNeed: toNumber(scoreBreakdown.outboundNeed) ?? 0,
      growthTrigger: toNumber(scoreBreakdown.growthTrigger) ?? 0,
      evidenceQuality: toNumber(scoreBreakdown.evidenceQuality) ?? 0,
      urgency: toNumber(scoreBreakdown.urgency) ?? 0,
      buyerClarity: toNumber(scoreBreakdown.buyerClarity) ?? 0,
      negativePenalty: toNumber(scoreBreakdown.negativePenalty) ?? 0,
    },

    aiScoreReasoning: cleanText(result.scoreReasoning || result.aiScoreReasoning || ""),
    aiWhyNow: cleanText(result.whyNow || result.aiWhyNow || ""),
    aiRecommendedBuyer: cleanText(result.recommendedBuyer || result.aiRecommendedBuyer || ""),
    aiOutreachAngle: cleanText(result.outreachAngle || result.aiOutreachAngle || ""),
    aiNextAction: cleanText(result.nextAction || result.aiNextAction || ""),
    aiDisqualifiers: Array.isArray(result.disqualifiers)
      ? result.disqualifiers.map(cleanText).filter(Boolean)
      : [],

    description: inputCompany.evidenceRows
      .map((row) => row.evidenceText)
      .filter(Boolean)
      .slice(0, 4)
      .join(" "),
  };
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

function writeCsv(filePath, rows) {
  const preferredKeys = [
    "aiEnrichedSeq",
    "companyKey",
    "rawName",
    "aiIntentScore",
    "aiScoreSource",
    "aiConfidence",
    "aiDecision",
    "aiBuyingStage",
    "aiIcpFit",
    "aiBuyerNeed",
    "aiSalesMotion",
    "aiCompanyType",
    "aiEntityType",
    "aiIsPotentialCustomer",
    "aiIsBadLead",
    "aiScoreReasoning",
    "aiWhyNow",
    "aiRecommendedBuyer",
    "aiOutreachAngle",
    "aiNextAction",
    "mentionCount",
    "sourceName",
    "sourceType",
    "sourceUrl",
  ];

  const allKeys = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set(preferredKeys))
  );

  const csv = [
    allKeys.map(csvEscape).join(","),
    ...rows.map((row) => allKeys.map((key) => csvEscape(row[key])).join(",")),
  ].join("\n");

  fs.writeFileSync(filePath, csv);
}

function buildPrompt(companies) {
  return `
You are an AI sales intelligence analyst for outbound sales support, appointment-setting, SDR support, lead generation, and pipeline generation services.

Return exactly one valid JSON object for every input company. Do not omit any company. Return ONLY a JSON array.

Every object MUST include all fields below. If a company is bad/not relevant, still give a numeric intentScore and confidence. A true score of 0 is allowed only when the entity is trash/not a real buyer company, and you must explain why.

Required fields for every object:
- companyKey: exactly the same input companyKey
- companyName
- cleanCompanyName
- entityType: buyer_company, vendor_or_agency, job_board_or_staffing, event_or_conference_label, person_or_role, unknown
- isRealCompany: boolean
- companyType: b2b_saas, b2b_software, ecommerce, fintech, healthcare, agency, recruiting_staffing, consumer, nonprofit, enterprise, local_services, unknown
- isPotentialCustomer: boolean
- isBadLead: boolean
- badLeadReason: string
- icpFit: high, medium, low, not_fit
- buyingStage: high_intent, medium_intent, low_intent, research_more, not_relevant
- decision: hot_lead, warm_lead, nurture, research_more, not_relevant, trash
- buyerNeed: pipeline_generation, appointment_setting, outbound_sales, customer_acquisition, partnerships, fundraising, none, unknown
- salesMotion: b2b_outbound, b2b_inbound, partner_channel, b2c, marketplace, nonprofit_fundraising, unknown
- companySizeGuess: startup, smb, mid_market, enterprise, unknown
- signals: array of { type, strength, evidence, sourceName }
- intentScore: integer 0-100
- confidence: integer 0-100
- confidenceReason: string
- scoreBreakdown: { icpFit, outboundNeed, growthTrigger, evidenceQuality, urgency, buyerClarity, negativePenalty }
- scoreReasoning: string
- whyNow: string
- recommendedBuyer: string
- outreachAngle: string
- nextAction: string
- disqualifiers: array

Score rubric:
- icpFit: 0-25
- outboundNeed: 0-25
- growthTrigger: 0-20
- evidenceQuality: 0-15
- urgency: 0-10
- buyerClarity: 0-5
- negativePenalty: 0 to -40
Final intentScore = sum, clamped 0-100.

Decision calibration:
- hot_lead requires intentScore >= 85, confidence >= 70, clear buyer need, and high/medium ICP fit.
- warm_lead is usually 70-84.
- nurture is usually 50-69.
- research_more is weak or incomplete evidence.
- not_relevant is a real entity but not a good buyer.
- trash is not a real buyer company or obvious garbage.

Input companies:
${JSON.stringify(companies, null, 2)}
`;
}

function companyPromptPayload(company) {
  return {
    companyKey: company.companyKey,
    companyName: company.companyName,
    rawNames: company.rawNames,
    websites: company.websites,
    sourceNames: company.sourceNames,
    sourceTypes: company.sourceTypes,
    sourceUrls: company.sourceUrls,
    countries: company.countries,
    latestActivityDate: company.latestActivityDate,
    mentionCount: company.mentionCount,
    evidenceRows: company.evidenceRows,
  };
}

async function requestAiResultsForCompanies(companies) {
  const prompt = buildPrompt(companies.map(companyPromptPayload));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    aiModel
  )}:generateContent?key=${encodeURIComponent(aiApiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    }),
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Gemini API failed ${response.status}: ${bodyText.slice(0, 1200)}`);
  }

  const body = JSON.parse(bodyText);
  const text =
    body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") ||
    "";

  const parsed = safeJsonParse(text || "[]");
  const resultArray = Array.isArray(parsed)
    ? parsed
    : parsed.results || parsed.companies || [];

  if (!Array.isArray(resultArray)) {
    throw new Error("AI response was not a JSON array.");
  }

  return resultArray;
}

function matchResultsToCompanies(resultArrayRaw, companies) {
  const resultsByKey = new Map();

  resultArrayRaw.forEach((result, index) => {
    if (result && result.companyKey) {
      resultsByKey.set(String(result.companyKey), { result, index });
    }
  });

  const usedResultIndexes = new Set();
  const matched = [];

  for (let index = 0; index < companies.length; index += 1) {
    const inputCompany = companies[index];
    let selected = null;
    let matchMethod = "none";

    const exact = resultsByKey.get(inputCompany.companyKey);
    if (exact && !usedResultIndexes.has(exact.index)) {
      selected = exact.result;
      usedResultIndexes.add(exact.index);
      matchMethod = "companyKey";
    }

    if (!selected) {
      const inputName = normalizeCompanyName(inputCompany.companyName);

      for (let i = 0; i < resultArrayRaw.length; i += 1) {
        if (usedResultIndexes.has(i)) continue;

        const candidate = resultArrayRaw[i];
        if (!candidate || typeof candidate !== "object") continue;

        const candidateName = normalizeCompanyName(
          candidate.cleanCompanyName || candidate.companyName || candidate.rawName || ""
        );

        if (candidateName && inputName && candidateName === inputName) {
          selected = candidate;
          usedResultIndexes.add(i);
          matchMethod = "companyName";
          break;
        }
      }
    }

    if (
      !selected &&
      resultArrayRaw[index] &&
      typeof resultArrayRaw[index] === "object" &&
      !usedResultIndexes.has(index)
    ) {
      selected = resultArrayRaw[index];
      usedResultIndexes.add(index);
      matchMethod = "position";
    }

    if (!selected) {
      matched.push({ inputCompany, result: null, error: "missing result" });
      continue;
    }

    const repaired = {
      ...selected,
      companyKey: inputCompany.companyKey,
      companyName: selected.companyName || inputCompany.companyName,
      cleanCompanyName:
        selected.cleanCompanyName || selected.companyName || inputCompany.companyName,
    };

    const validationError = validateAiResult(repaired, inputCompany);
    matched.push({ inputCompany, result: repaired, error: validationError, matchMethod });
  }

  return matched;
}

async function enrichChunkWithRetry(companies, depth = 0) {
  const prefix = "  ".repeat(depth);

  try {
    console.log(`${prefix}Gemini request for ${companies.length} companies...`);
    const results = await requestAiResultsForCompanies(companies);
    const matched = matchResultsToCompanies(results, companies);
    const invalid = matched.filter((item) => item.error);

    if (invalid.length > 0) {
      throw new Error(
        `Invalid AI results: ${invalid
          .map((item) => `${item.inputCompany.companyName}: ${item.error}`)
          .join("; ")}`
      );
    }

    console.log(`${prefix}Gemini request succeeded for ${companies.length} companies.`);
    return matched.map((item) => item.result);
  } catch (error) {
    console.warn(`${prefix}Gemini request failed for ${companies.length} companies: ${error.message}`);

    if (companies.length <= 1) {
      throw new Error(
        `Single company AI review failed for ${companies[0]?.companyName}: ${error.message}`
      );
    }

    const mid = Math.ceil(companies.length / 2);
    const left = companies.slice(0, mid);
    const right = companies.slice(mid);

    console.warn(`${prefix}Retrying as ${left.length} + ${right.length} companies...`);

    const leftResults = await enrichChunkWithRetry(left, depth + 1);
    const rightResults = await enrichChunkWithRetry(right, depth + 1);

    return [...leftResults, ...rightResults];
  }
}

async function run() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const sourceRows = readJson(INPUT_JSON);
  const existingRows = readJson(OUTPUT_JSON);

  const existingByKey = new Map(existingRows.map((row) => [row.companyKey, row]));
  const companies = groupCompanies(sourceRows);
  const remainingCompanies = companies.filter((company) => !existingByKey.has(company.companyKey));
  const batch = remainingCompanies.slice(0, BATCH_SIZE);

  console.log("Company-level AI enrichment - strict microbatch");
  console.log("---------------------------------------------");
  console.log(`Provider: ${aiProvider}`);
  console.log(`Model: ${aiModel}`);
  console.log(`Pre-clean rows: ${sourceRows.length}`);
  console.log(`Unique companies: ${companies.length}`);
  console.log(`Already AI-enriched companies: ${existingRows.length}`);
  console.log(`Remaining companies: ${remainingCompanies.length}`);
  console.log(`Batch size this run: ${batch.length}`);
  console.log(`Gemini sub-batch size: ${AI_SUB_BATCH_SIZE}`);

  if (batch.length === 0) {
    console.log("Nothing to enrich.");
    return;
  }

  const resultArray = [];

  for (let i = 0; i < batch.length; i += AI_SUB_BATCH_SIZE) {
    const chunk = batch.slice(i, i + AI_SUB_BATCH_SIZE);
    console.log(`\nReviewing companies ${i + 1}-${i + chunk.length} of ${batch.length}`);
    const chunkResults = await enrichChunkWithRetry(chunk);
    resultArray.push(...chunkResults);
  }

  const newRows = [];

  for (const inputCompany of batch) {
    const result = resultArray.find((item) => item.companyKey === inputCompany.companyKey);

    if (!result) {
      throw new Error(`Missing AI result after strict review for: ${inputCompany.companyName}`);
    }

    const normalized = normalizeResult(result, inputCompany);
    newRows.push(normalized);

    console.log(
      `${normalized.rawName} -> ${normalized.aiIntentScore} | ${normalized.aiDecision} | ${normalized.aiConfidence}% confidence | ${normalized.aiIcpFit} | scoreSource: ${normalized.aiScoreSource}`
    );
  }

  const mergedByKey = new Map(existingRows.map((row) => [row.companyKey, row]));
  const existingMaxSeq = existingRows.reduce(
    (max, row) => Math.max(max, Number(row.aiEnrichedSeq || 0)),
    0
  );

  newRows.forEach((row, index) => {
    mergedByKey.set(row.companyKey, {
      ...row,
      aiEnrichedSeq: existingMaxSeq + index + 1,
    });
  });

  const outputRows = Array.from(mergedByKey.values()).sort(
    (a, b) => Number(a.aiEnrichedSeq || 0) - Number(b.aiEnrichedSeq || 0)
  );

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(outputRows, null, 2));
  writeCsv(OUTPUT_CSV, outputRows);

  console.log("");
  console.log("Company-level AI enrichment complete");
  console.log("------------------------------------");
  console.log(`New companies enriched: ${newRows.length}`);
  console.log(`Total AI-enriched companies saved: ${outputRows.length}`);
  console.log(`Zero-score rows in new batch: ${newRows.filter((row) => row.aiIntentScore === 0).length}`);
  console.log(`Wrote ${OUTPUT_JSON}`);
  console.log(`Wrote ${OUTPUT_CSV}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
