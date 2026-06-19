export type SourceType =
  | "conference"
  | "accelerator"
  | "startup_directory"
  | "careers_page"
  | "funding_news";

export type RawCompanyMention = {
  id: string;
  rawName: string;
  website?: string;
  sourceType: SourceType;
  sourceName?: string;
  sourceUrl: string;
  description?: string;
  homepageText?: string;
  careersText?: string;
  lastActivityDate?: string;

  country?: string;
  estimatedSize?: string;
  stageHint?: string;
  agentConfidence?: number;
  expectedCategory?: string;
  expectedTrashReason?: string;
};

export type ResolvedCompany = {
  id: string;
  canonicalName: string;
  rootDomain?: string;
  aliases: string[];
  sources: SourceType[];
  rawMentions: RawCompanyMention[];
  identityConfidence: number;
};

export type QualificationStatus =
  | "qualified"
  | "needs_review"
  | "disqualified";

export type QualifiedCompany = ResolvedCompany & {
  status: QualificationStatus;
  qualificationScore: number;
  qualificationReasons: string[];
  disqualificationReason?: string;
  evidence: {
    type: string;
    text: string;
    sourceUrl: string;
  }[];
};
