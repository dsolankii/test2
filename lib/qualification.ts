import { QualifiedCompany, ResolvedCompany } from "@/types/company";

function containsAny(text: string, keywords: string[]) {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function getAllText(company: ResolvedCompany) {
  return company.rawMentions
    .map((mention) =>
      [mention.description, mention.homepageText, mention.careersText]
        .filter(Boolean)
        .join(" ")
    )
    .join(" ");
}

function isRecentlyActive(company: ResolvedCompany) {
  const dates = company.rawMentions
    .map((mention) => mention.lastActivityDate)
    .filter(Boolean)
    .map((date) => new Date(date as string).getTime());

  if (!dates.length) return false;

  const latest = Math.max(...dates);
  const daysAgo = (Date.now() - latest) / (1000 * 60 * 60 * 24);

  return daysAgo <= 180;
}

export function qualifyCompany(company: ResolvedCompany): QualifiedCompany {
  const text = getAllText(company);

  const reasons: string[] = [];
  const evidence: QualifiedCompany["evidence"] = [];

  let score = 0;
  let hardDisqualification: string | undefined;

  const isDeadWebsite = containsAny(text, [
    "domain is for sale",
    "this domain is for sale",
    "parked domain",
    "404",
    "not found",
  ]);

  if (isDeadWebsite) {
    hardDisqualification = "Dead or parked website";
  }

  const isB2B = containsAny(text, [
    "b2b",
    "businesses",
    "sales teams",
    "revenue teams",
    "finance teams",
    "companies",
  ]);

  const isSaaS = containsAny(text, [
    "saas",
    "software",
    "platform",
    "automation",
    "dashboard",
    "workflow",
  ]);

  const hasSalesMotion = containsAny(text, [
    "book a demo",
    "request a demo",
    "sales team",
    "pipeline",
    "revenue",
    "gtm",
    "go-to-market",
  ]);

  const hasRelevantHiring = containsAny(text, [
    "sales development representative",
    "sdr",
    "bdr",
    "account executive",
    "head of sales",
    "vp sales",
    "revenue operations",
  ]);

  const isAgency = containsAny(text, [
    "creative agency",
    "design agency",
    "branding agency",
    "web design agency",
    "marketing agency",
  ]);

  if (isB2B) {
    score += 20;
    reasons.push("Matches B2B company profile");
  }

  if (isSaaS) {
    score += 20;
    reasons.push("Looks like SaaS/software company");
  }

  if (hasSalesMotion) {
    score += 15;
    reasons.push("Has sales/demo/GTM motion");
  }

  if (hasRelevantHiring) {
    score += 20;
    reasons.push("Hiring sales or revenue roles");
  }

  if (isRecentlyActive(company)) {
    score += 15;
    reasons.push("Recent activity detected");
  }

  if (company.sources.length > 1) {
    score += 10;
    reasons.push("Found across multiple sources");
  }

  if (isAgency) {
    score -= 35;
    hardDisqualification = "Not ICP: agency/service provider";
  }

  for (const mention of company.rawMentions) {
    if (mention.homepageText) {
      evidence.push({
        type: "website_text",
        text: mention.homepageText.slice(0, 180),
        sourceUrl: mention.sourceUrl,
      });
    }

    if (mention.careersText) {
      evidence.push({
        type: "careers_text",
        text: mention.careersText.slice(0, 180),
        sourceUrl: mention.sourceUrl,
      });
    }
  }

  let status: QualifiedCompany["status"] = "needs_review";
  let disqualificationReason: string | undefined;

  if (hardDisqualification) {
    status = "disqualified";
    disqualificationReason = hardDisqualification;
  } else if (score >= 60 && evidence.length >= 1) {
    status = "qualified";
  } else if (score < 35) {
    status = "disqualified";
    disqualificationReason = "Low ICP relevance or weak evidence";
  }

  return {
    ...company,
    status,
    qualificationScore: Math.max(0, Math.min(score, 100)),
    qualificationReasons: reasons,
    disqualificationReason,
    evidence,
  };
}
