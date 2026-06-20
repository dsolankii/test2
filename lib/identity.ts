import { RawCompanyMention, ResolvedCompany } from "@/types/company";

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/\b(ai|inc|inc\.|ltd|llc|corp|corporation)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function getRootDomain(website?: string) {
  if (!website) return undefined;

  try {
    const url = new URL(
      website.startsWith("http") ? website : `https://${website}`
    );

    return url.hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function calculateIdentityConfidence(group: RawCompanyMention[]) {
  const hasDomain = group.some((item) => getRootDomain(item.website));
  const hasMultipleSources = new Set(group.map((item) => item.sourceType)).size > 1;
  const hasMultipleMentions = group.length > 1;

  let score = 50;

  if (hasDomain) score += 25;
  if (hasMultipleSources) score += 15;
  if (hasMultipleMentions) score += 10;

  return Math.min(score, 100);
}

export function resolveCompanies(
  rawMentions: RawCompanyMention[]
): ResolvedCompany[] {
  const groups = new Map<string, RawCompanyMention[]>();

  for (const mention of rawMentions) {
    const domain = getRootDomain(mention.website);
    const rawNameKey = normalizeName(mention.rawName);
    const key = domain || rawNameKey;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key)!.push(mention);
  }

  return Array.from(groups.entries()).map(([_, mentions], index) => {
    const bestMention = mentions.find((mention) => mention.website) || mentions[0];

    return {
      id: `company_${index + 1}`,
      canonicalName: bestMention.rawName,
      rootDomain: getRootDomain(bestMention.website),
      aliases: Array.from(new Set(mentions.map((item) => item.rawName))),
      sources: Array.from(new Set(mentions.map((item) => item.sourceType))),
      rawMentions: mentions,
      identityConfidence: calculateIdentityConfidence(mentions),
    };
  });
}
