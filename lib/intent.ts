import { QualifiedCompany } from "@/types/company";

export type IntentSignal = {
  type:
    | "sales_hiring"
    | "gtm_expansion"
    | "funding_or_growth"
    | "conference_presence"
    | "accelerator_presence"
    | "multi_source_validation"
    | "demo_sales_motion";
  label: string;
  points: number;
  evidence: string;
};

export type IntentScoredCompany = QualifiedCompany & {
  intentScore: number;
  intentSignals: IntentSignal[];
  whyNow: string;
  outreachAngle: string;
  recommendedBuyer: string;
};

function getAllText(company: QualifiedCompany) {
  return company.rawMentions
    .map((mention) =>
      [
        mention.description,
        mention.homepageText,
        mention.careersText,
        mention.sourceName,
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join(" ")
    .toLowerCase();
}

function containsAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function getLatestActivityDaysAgo(company: QualifiedCompany) {
  const dates = company.rawMentions
    .map((mention) => mention.lastActivityDate)
    .filter(Boolean)
    .map((date) => new Date(date as string).getTime());

  if (!dates.length) return null;

  const latest = Math.max(...dates);
  return (Date.now() - latest) / (1000 * 60 * 60 * 24);
}

export function scoreIntent(company: QualifiedCompany): IntentScoredCompany {
  if (company.status !== "qualified") {
    return {
      ...company,
      intentScore: 0,
      intentSignals: [],
      whyNow:
        "This company did not pass qualification gates, so intent scoring was not applied.",
      outreachAngle:
        "Do not prioritize this account until qualification evidence improves.",
      recommendedBuyer: "N/A",
    };
  }

  const text = getAllText(company);
  const signals: IntentSignal[] = [];

  const hasSDRHiring = containsAny(text, [
    "sales development representative",
    "sdr",
    "bdr",
    "business development representative",
  ]);

  const hasAEHiring = containsAny(text, [
    "account executive",
    "ae",
    "sales manager",
  ]);

  const hasSalesLeadershipHiring = containsAny(text, [
    "head of sales",
    "vp sales",
    "vice president of sales",
    "revenue operations",
    "revops",
    "cro",
    "chief revenue officer",
  ]);

  if (hasSDRHiring || hasAEHiring || hasSalesLeadershipHiring) {
    let points = 25;

    if (hasSDRHiring) points += 10;
    if (hasAEHiring) points += 7;
    if (hasSalesLeadershipHiring) points += 8;

    signals.push({
      type: "sales_hiring",
      label: "Sales / revenue hiring",
      points: Math.min(points, 40),
      evidence:
        "Company is hiring SDR, AE, Head of Sales, RevOps, or related revenue roles.",
    });
  }

  if (
    containsAny(text, [
      "gtm",
      "go-to-market",
      "pipeline",
      "revenue team",
      "sales workflow",
      "qualified opportunities",
      "customer acquisition",
      "expand our sales",
      "growing our go-to-market",
    ])
  ) {
    signals.push({
      type: "gtm_expansion",
      label: "GTM / pipeline language",
      points: 18,
      evidence:
        "Company text mentions GTM, pipeline, sales workflows, or revenue growth.",
    });
  }

  if (
    company.sources.includes("funding_news") ||
    containsAny(text, ["funded", "seed round", "series a", "series b", "raised"])
  ) {
    signals.push({
      type: "funding_or_growth",
      label: "Funding / growth source",
      points: 15,
      evidence:
        "Company appeared in funding or growth source, suggesting growth pressure.",
    });
  }

  if (company.sources.includes("conference")) {
    signals.push({
      type: "conference_presence",
      label: "Conference presence",
      points: 10,
      evidence:
        "Company appeared in a SaaS/GTM conference source, suggesting growth visibility and market activity.",
    });
  }

  if (company.sources.includes("accelerator")) {
    signals.push({
      type: "accelerator_presence",
      label: "Accelerator / demo day source",
      points: 8,
      evidence:
        "Company appeared in an accelerator/startup batch source, suggesting early-stage growth focus.",
    });
  }

  if (company.sources.length >= 2) {
    signals.push({
      type: "multi_source_validation",
      label: "Multiple source validation",
      points: 10,
      evidence:
        "Company was found across multiple source types, increasing confidence.",
    });
  }

  if (
    containsAny(text, [
      "book a demo",
      "request a demo",
      "sales team",
      "contact sales",
      "schedule a demo",
    ])
  ) {
    signals.push({
      type: "demo_sales_motion",
      label: "Has demo / sales motion",
      points: 12,
      evidence:
        "Company has demo or contact-sales language, indicating a sales-led motion.",
    });
  }

  const latestDaysAgo = getLatestActivityDaysAgo(company);
  let recencyBoost = 0;

  if (latestDaysAgo !== null) {
    if (latestDaysAgo <= 30) recencyBoost = 10;
    else if (latestDaysAgo <= 90) recencyBoost = 7;
    else if (latestDaysAgo <= 180) recencyBoost = 4;
  }

  const rawScore =
    signals.reduce((sum, signal) => sum + signal.points, 0) + recencyBoost;

  const intentScore = Math.min(100, Math.round(rawScore));

  const topSignals = signals.slice(0, 3).map((signal) => signal.label);

  const whyNow =
    topSignals.length > 0
      ? `${company.canonicalName} is showing buying-moment signals: ${topSignals.join(
          ", "
        )}. This suggests they may be investing in pipeline, GTM growth, or sales capacity right now.`
      : `${company.canonicalName} passed qualification, but no strong intent signal was detected yet.`;

  const recommendedBuyer = hasSalesLeadershipHiring
    ? "Founder, CEO, CRO, VP Sales, Head of Sales"
    : hasSDRHiring || hasAEHiring
    ? "Founder, CEO, VP Sales, Head of Sales, RevOps"
    : "Founder, CEO, Head of Growth, Revenue Leader";

  const outreachAngle =
    signals.length > 0
      ? `Lead with the strongest signal: ${signals[0].label}. Mention that they appear to be investing in GTM/sales growth and position appointment-setting as a way to generate qualified meetings while their internal team ramps.`
      : "Use a softer discovery angle focused on whether pipeline generation or outbound support is a current priority.";

  return {
    ...company,
    intentScore,
    intentSignals: signals,
    whyNow,
    outreachAngle,
    recommendedBuyer,
  };
}

export function scoreIntentForCompanies(
  companies: QualifiedCompany[]
): IntentScoredCompany[] {
  return companies
    .map(scoreIntent)
    .sort((a, b) => b.intentScore - a.intentScore);
}
