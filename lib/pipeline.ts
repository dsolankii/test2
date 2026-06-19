import { runSourceExtractionAgent } from "@/lib/sourceAgent";
import { resolveCompanies } from "@/lib/identity";
import { qualifyCompany } from "@/lib/qualification";
import { scoreIntentForCompanies } from "@/lib/intent";

export function runCompanyPipeline() {
  const { sourceConfigs, extractionRuns } = runSourceExtractionAgent();

  const rawCompanies = extractionRuns.flatMap((run) => run.rawMentions);
  const resolvedCompanies = resolveCompanies(rawCompanies);
  const qualifiedCompanies = resolvedCompanies.map(qualifyCompany);
  const intentScoredCompanies = scoreIntentForCompanies(qualifiedCompanies);

  return {
    sourceConfigs,
    extractionRuns,
    rawCompanies,
    resolvedCompanies,
    qualifiedCompanies,
    intentScoredCompanies,
  };
}
