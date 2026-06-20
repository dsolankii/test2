"use client";

import { useMemo, useState } from "react";
import Papa from "papaparse";
import { resolveCompanies } from "@/lib/identity";
import { qualifyCompany } from "@/lib/qualification";
import { scoreIntentForCompanies, IntentScoredCompany } from "@/lib/intent";
import { RawCompanyMention, SourceType } from "@/types/company";

type SourceConfig = {
  id: string;
  name: string;
  sourceType: SourceType;
  url: string;
  strategy: string;
  whyUseful: string;
};

type Tab = "overview" | "sources" | "upload" | "leads" | "trash";

type Props = {
  initialRawMentions: RawCompanyMention[];
  sourceConfigs: SourceConfig[];
};

const allowedSourceTypes = new Set([
  "conference",
  "accelerator",
  "startup_directory",
  "careers_page",
  "funding_news",
]);

function parseSourceType(value: unknown): SourceType {
  const sourceType = String(value || "startup_directory");

  if (allowedSourceTypes.has(sourceType)) {
    return sourceType as SourceType;
  }

  return "startup_directory";
}

function normalizeCsvRow(row: Record<string, unknown>, index: number): RawCompanyMention {
  return {
    id: String(row.id || `uploaded_raw_${index + 1}`),
    rawName: String(row.rawName || row.company_name || row.company || "Unknown Company"),
    website: row.website ? String(row.website) : undefined,
    sourceType: parseSourceType(row.sourceType || row.source_type),
    sourceName: row.sourceName ? String(row.sourceName) : undefined,
    sourceUrl: String(row.sourceUrl || row.source_url || "uploaded_csv"),
    description: row.description ? String(row.description) : "",
    homepageText: row.homepageText ? String(row.homepageText) : "",
    careersText: row.careersText ? String(row.careersText) : "",
    lastActivityDate: row.lastActivityDate ? String(row.lastActivityDate) : undefined,
    country: row.country ? String(row.country) : undefined,
    estimatedSize: row.estimatedSize ? String(row.estimatedSize) : undefined,
    stageHint: row.stageHint ? String(row.stageHint) : undefined,
    agentConfidence: row.agentConfidence ? Number(row.agentConfidence) : undefined,
    expectedCategory: row.expectedCategory ? String(row.expectedCategory) : undefined,
    expectedTrashReason: row.expectedTrashReason ? String(row.expectedTrashReason) : undefined,
  };
}

function statusLabel(status: string) {
  if (status === "qualified") return "Qualified";
  if (status === "needs_review") return "Needs Review";
  return "Disqualified";
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "qualified"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
      : status === "needs_review"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"
      : "bg-red-100 text-red-700 dark:bg-red-400/10 dark:text-red-300";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${className}`}>
      {statusLabel(status)}
    </span>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const className =
    score >= 80
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
      : score >= 50
      ? "bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"
      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${className}`}>
      Intent {score}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
      {message}
    </div>
  );
}

export default function LeadDashboard({
  initialRawMentions,
  sourceConfigs,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [darkMode, setDarkMode] = useState(false);
  const [rawMentions, setRawMentions] = useState<RawCompanyMention[]>(initialRawMentions);
  const [datasetName, setDatasetName] = useState("Demo source-agent dataset");
  const [search, setSearch] = useState("");
  const [onlyHighIntent, setOnlyHighIntent] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const pipeline = useMemo(() => {
    const resolvedCompanies = resolveCompanies(rawMentions);
    const qualifiedCompanies = resolvedCompanies.map(qualifyCompany);
    const intentScoredCompanies = scoreIntentForCompanies(qualifiedCompanies);

    const qualified = intentScoredCompanies.filter(
      (company) => company.status === "qualified"
    );

    const needsReview = intentScoredCompanies.filter(
      (company) => company.status === "needs_review"
    );

    const disqualified = intentScoredCompanies.filter(
      (company) => company.status === "disqualified"
    );

    const highIntent = qualified.filter((company) => company.intentScore >= 80);

    return {
      resolvedCompanies,
      qualifiedCompanies,
      intentScoredCompanies,
      qualified,
      needsReview,
      disqualified,
      highIntent,
    };
  }, [rawMentions]);

  const extractionCounts = useMemo(() => {
    return sourceConfigs.map((source) => {
      const count = rawMentions.filter(
        (mention) => mention.sourceType === source.sourceType
      ).length;

      return {
        ...source,
        extractedCount: count,
      };
    });
  }, [rawMentions, sourceConfigs]);

  const filteredLeads = useMemo(() => {
    return pipeline.qualified.filter((company) => {
      const matchesSearch =
        company.canonicalName.toLowerCase().includes(search.toLowerCase()) ||
        (company.rootDomain || "").toLowerCase().includes(search.toLowerCase()) ||
        company.sources.join(" ").toLowerCase().includes(search.toLowerCase());

      const matchesIntent = onlyHighIntent ? company.intentScore >= 80 : true;

      return matchesSearch && matchesIntent;
    });
  }, [pipeline.qualified, search, onlyHighIntent]);

  function handleUpload(file?: File) {
    if (!file) return;

    setUploadError("");

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          setUploadError("CSV parsing failed. Please check the file format.");
          return;
        }

        const rows = results.data
          .filter((row) => row.rawName || row.company_name || row.company)
          .map(normalizeCsvRow);

        if (!rows.length) {
          setUploadError(
            "No valid companies found. Required column: rawName or company_name."
          );
          return;
        }

        setRawMentions(rows);
        setDatasetName(file.name);
        setActiveTab("overview");
      },
      error: () => {
        setUploadError("Could not read CSV file.");
      },
    });
  }

  function resetDemoData() {
    setRawMentions(initialRawMentions);
    setDatasetName("Demo source-agent dataset");
    setUploadError("");
    setSearch("");
    setOnlyHighIntent(false);
    setActiveTab("overview");
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "sources", label: "Sources" },
    { id: "upload", label: "Upload CSV" },
    { id: "leads", label: "Ranked Leads" },
    { id: "trash", label: "Trash Removed" },
  ];

  const pageClass = darkMode
    ? "dark min-h-screen bg-slate-950 text-slate-100"
    : "min-h-screen bg-slate-50 text-slate-900";

  const cardClass =
    "rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800";

  return (
    <main className={pageClass}>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">
              Agentic Lead Discovery POC
            </p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight">
              Buying Signal Monitor
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              A product-style dashboard that turns noisy source-agent output into
              deduplicated, qualified, intent-scored companies for outbound and
              appointment-setting teams.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setDarkMode((value) => !value)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {darkMode ? "Light mode" : "Dark mode"}
            </button>

            <button
              onClick={resetDemoData}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              Reset generated data
            </button>
          </div>
        </header>

        <section className="mt-8 rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
          <span className="font-semibold">Current dataset:</span> {datasetName}.{" "}
          The app is processing {rawMentions.length.toLocaleString()} raw source
          mentions through identity resolution, qualification gates, and intent
          scoring.
        </section>

        <nav className="mt-6 flex flex-wrap gap-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {activeTab === "overview" && (
          <div className="mt-6 space-y-6">
            <section className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <MetricCard label="Raw mentions" value={rawMentions.length} />
              <MetricCard label="Resolved companies" value={pipeline.resolvedCompanies.length} />
              <MetricCard label="Qualified" value={pipeline.qualified.length} />
              <MetricCard label="Needs review" value={pipeline.needsReview.length} />
              <MetricCard label="Trash removed" value={pipeline.disqualified.length} />
              <MetricCard label="High intent" value={pipeline.highIntent.length} />
            </section>

            <section className={cardClass}>
              <h2 className="text-xl font-semibold">Funnel summary</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                This shows the core product logic: broad noisy sources are allowed
                at the top, then the system cleans, qualifies, and prioritizes.
              </p>

              <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-4">
                <FunnelStep
                  step="1"
                  title="Source agent"
                  value={rawMentions.length}
                  description="Raw companies extracted from conferences, accelerators, directories, funding, and job sources."
                />
                <FunnelStep
                  step="2"
                  title="Identity resolution"
                  value={pipeline.resolvedCompanies.length}
                  description="Repeated mentions are merged into canonical company records."
                />
                <FunnelStep
                  step="3"
                  title="Qualification gates"
                  value={pipeline.qualified.length}
                  description="Dead, stale, agency, and irrelevant companies are removed."
                />
                <FunnelStep
                  step="4"
                  title="Intent scoring"
                  value={pipeline.highIntent.length}
                  description="High-intent companies are ranked by sales hiring, GTM language, funding, and source quality."
                />
              </div>
            </section>

            <section className={cardClass}>
              <h2 className="text-xl font-semibold">Top 5 opportunities</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                A quick executive view of the best companies to review first.
              </p>

              <div className="mt-5 grid grid-cols-1 gap-4">
                {pipeline.qualified.slice(0, 5).map((company, index) => (
                  <LeadCard key={company.id} company={company} rank={index + 1} />
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === "sources" && (
          <section className={`mt-6 ${cardClass}`}>
            <h2 className="text-xl font-semibold">Source agent runs</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              For the POC, the CSV represents extracted output. In V2, each source
              becomes a real crawler/API/source adapter.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {extractionCounts.map((source) => (
                <div
                  key={source.id}
                  className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold">{source.name}</h3>
                      <p className="mt-1 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {source.sourceType}
                      </p>
                    </div>

                    <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-300">
                      {source.extractedCount} extracted
                    </span>
                  </div>

                  <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Why useful:
                    </span>{" "}
                    {source.whyUseful}
                  </p>

                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Agent strategy:
                    </span>{" "}
                    {source.strategy}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "upload" && (
          <section className={`mt-6 ${cardClass}`}>
            <h2 className="text-xl font-semibold">Upload CSV</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Upload a new source-agent output CSV. The app will immediately run
              identity resolution, qualification, and intent scoring in the browser.
            </p>

            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 dark:border-slate-700">
              <input
                type="file"
                accept=".csv"
                onChange={(event) => handleUpload(event.target.files?.[0])}
                className="block w-full rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />

              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                Supported columns: <code>rawName</code>, <code>website</code>,{" "}
                <code>sourceType</code>, <code>sourceUrl</code>,{" "}
                <code>description</code>, <code>homepageText</code>,{" "}
                <code>careersText</code>, <code>lastActivityDate</code>.
              </p>

              {uploadError && (
                <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-400/10 dark:text-red-300">
                  {uploadError}
                </p>
              )}

              <button
                onClick={resetDemoData}
                className="mt-5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Reset generated dataset
              </button>
            </div>
          </section>
        )}

        {activeTab === "leads" && (
          <section className={`mt-6 ${cardClass}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Ranked leads</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Qualified companies sorted by intent score.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search company, domain, source..."
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950"
                />

                <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm dark:border-slate-700">
                  <input
                    type="checkbox"
                    checked={onlyHighIntent}
                    onChange={(event) => setOnlyHighIntent(event.target.checked)}
                  />
                  High intent only
                </label>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4">
              {filteredLeads.slice(0, 50).map((company, index) => (
                <LeadCard key={company.id} company={company} rank={index + 1} />
              ))}

              {!filteredLeads.length && (
                <EmptyState message="No companies match the current filters." />
              )}
            </div>
          </section>
        )}

        {activeTab === "trash" && (
          <section className={`mt-6 ${cardClass}`}>
            <h2 className="text-xl font-semibold">Trash removed</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              These companies were blocked before sales review because they were
              dead, stale, irrelevant, agencies, or had weak evidence.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {pipeline.disqualified.slice(0, 40).map((company) => (
                <div
                  key={company.id}
                  className="rounded-2xl border border-red-100 bg-red-50 p-5 dark:border-red-900/50 dark:bg-red-950/30"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-red-950 dark:text-red-200">
                        {company.canonicalName}
                      </h3>
                      <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                        {company.rootDomain || "No domain"}
                      </p>
                    </div>

                    <StatusBadge status={company.status} />
                  </div>

                  <p className="mt-4 text-sm text-red-800 dark:text-red-200">
                    Removed because:{" "}
                    {company.disqualificationReason || "Low evidence quality"}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {company.qualificationReasons.slice(0, 3).map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full bg-white px-3 py-1 text-xs text-red-700 ring-1 ring-red-100 dark:bg-red-950 dark:text-red-200 dark:ring-red-900"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>
              ))}

              {!pipeline.disqualified.length && (
                <EmptyState message="No disqualified companies found." />
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value.toLocaleString()}</p>
    </div>
  );
}

function FunnelStep({
  step,
  title,
  value,
  description,
}: {
  step: string;
  title: string;
  value: number;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white dark:bg-white dark:text-slate-900">
          {step}
        </span>
        <h3 className="font-semibold">{title}</h3>
      </div>

      <p className="mt-4 text-3xl font-bold">{value.toLocaleString()}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
        {description}
      </p>
    </div>
  );
}

function LeadCard({
  company,
  rank,
}: {
  company: IntentScoredCompany;
  rank: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-slate-400">Rank #{rank}</p>
          <h3 className="mt-1 text-lg font-semibold">{company.canonicalName}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {company.rootDomain || "No domain"} · Sources:{" "}
            {company.sources.join(", ")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={company.status} />
          <ScoreBadge score={company.intentScore} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {company.intentSignals.slice(0, 5).map((signal) => (
          <span
            key={`${company.id}-${signal.label}`}
            className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-300"
          >
            {signal.label} +{signal.points}
          </span>
        ))}
      </div>

      <div className="mt-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
        <p className="text-sm font-semibold">Why now</p>
        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
          {company.whyNow}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-sm font-semibold">Recommended buyer</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {company.recommendedBuyer}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-sm font-semibold">Outreach angle</p>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
            {company.outreachAngle}
          </p>
        </div>
      </div>
    </div>
  );
}
