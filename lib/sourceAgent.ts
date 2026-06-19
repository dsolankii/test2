import fs from "fs";
import { dataPath } from "@/lib/data-dir";
import { RawCompanyMention, SourceType } from "@/types/company";

export type SourceAgentConfig = {
  id: string;
  name: string;
  sourceType: SourceType;
  url: string;
  strategy: string;
  whyUseful: string;
};

export type AgentExtractionRun = {
  sourceId: string;
  sourceName: string;
  status: "completed" | "failed";
  extractedCount: number;
  notes: string;
  rawMentions: RawCompanyMention[];
};

function readRawMentions(): RawCompanyMention[] {
  try {
    const raw = fs.readFileSync(dataPath("raw-company-mentions.json"), "utf8");
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed)
      ? parsed.flatMap((item) =>
          Array.isArray(item?.mentions) ? item.mentions : [item]
        )
      : [];

    return rows as RawCompanyMention[];
  } catch {
    return [];
  }
}

function sourceIdFor(sourceType: string, sourceName: string) {
  return `${sourceType || "source"}-${sourceName || "unknown"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildSourceConfigs(rawMentions: RawCompanyMention[]): SourceAgentConfig[] {
  const bySource = new Map<string, SourceAgentConfig>();

  for (const mention of rawMentions) {
    const sourceType = mention.sourceType;
    const sourceName = mention.sourceName || sourceType || "Public signal";
    const key = sourceIdFor(sourceType, sourceName);

    if (!bySource.has(key)) {
      bySource.set(key, {
        id: key,
        name: sourceName,
        sourceType: sourceType as SourceType,
        url: mention.sourceUrl || mention.website || "",
        strategy: "Extract real public buying signals from the configured source.",
        whyUseful:
          "This source produced at least one real extracted company mention in the current run.",
      });
    }
  }

  return Array.from(bySource.values());
}

export function runSourceExtractionAgent(): {
  sourceConfigs: SourceAgentConfig[];
  extractionRuns: AgentExtractionRun[];
} {
  const rawMentions = readRawMentions();
  const sourceConfigs = buildSourceConfigs(rawMentions);

  const extractionRuns = sourceConfigs.map((source) => {
    const mentionsForSource = rawMentions.filter((mention) => {
      const key = sourceIdFor(
        mention.sourceType,
        mention.sourceName || mention.sourceType || "Public signal"
      );
      return key === source.id;
    });

    return {
      sourceId: source.id,
      sourceName: source.name,
      status: "completed" as const,
      extractedCount: mentionsForSource.length,
      notes: `Agent loaded ${mentionsForSource.length} real extracted mentions from ${source.name}.`,
      rawMentions: mentionsForSource,
    };
  });

  return {
    sourceConfigs,
    extractionRuns,
  };
}
