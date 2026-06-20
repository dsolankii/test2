"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Lead = Record<string, any>;

type LeadMeta = {
  totalAvailable: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  visibleStart: number;
  visibleEnd: number;
  visibleLeadCount: number;
  scoredVisibleLeads: number;
  hiddenLeft: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  canUnlockNext: boolean;
  nextStart: number;
  nextEnd: number;
};

const emptyMeta: LeadMeta = {
  totalAvailable: 0,
  totalPages: 1,
  currentPage: 0,
  pageSize: 50,
  visibleStart: 0,
  visibleEnd: 0,
  visibleLeadCount: 0,
  scoredVisibleLeads: 0,
  hiddenLeft: 0,
  canGoPrev: false,
  canGoNext: false,
  canUnlockNext: false,
  nextStart: 0,
  nextEnd: 0,
};

const filters = [
  { key: "all", label: "All" },
  { key: "hot", label: "High Intent" },
  { key: "warm", label: "Qualified" },
  { key: "nurture", label: "Monitor" },
  { key: "review", label: "Needs Review" },
  { key: "excluded", label: "Excluded" },
];

function compactText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/people generation/gi, "lead generation")
    .replace(/person generation/gi, "lead generation")
    .replace(/appointment setting/gi, "appointment-setting")
    .replace(/outbound sale\b/gi, "outbound sales")
    .replace(/sales people/gi, "sales team")
    .trim();
}

function sentence(value: string) {
  const clean = compactText(value);
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function short(value: unknown, max = 180) {
  const text = compactText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

function getDecision(lead: Lead) {
  return String(
    lead.aiDecision ||
      lead.decision ||
      lead.status ||
      lead.leadDecision ||
      "reviewed"
  ).toLowerCase();
}

function getDecisionLabel(decision: string) {
  if (decision.includes("hot")) return "High Intent";
  if (decision.includes("warm")) return "Qualified";
  if (decision.includes("nurture")) return "Monitor";
  if (decision.includes("research") || decision.includes("review")) return "Needs Review";
  if (
    decision.includes("trash") ||
    decision.includes("excluded") ||
    decision.includes("not_relevant")
  ) {
    return "Excluded";
  }
  return "Reviewed";
}

function getDecisionFilter(decision: string) {
  if (decision.includes("hot")) return "hot";
  if (decision.includes("warm")) return "warm";
  if (decision.includes("nurture")) return "nurture";
  if (decision.includes("research") || decision.includes("review")) return "review";
  if (
    decision.includes("trash") ||
    decision.includes("excluded") ||
    decision.includes("not_relevant")
  ) {
    return "excluded";
  }
  return "all";
}

function getCompanyName(lead: Lead) {
  return compactText(
    lead.companyName ||
      lead.company ||
      lead.name ||
      lead.aiCompanyName ||
      lead.accountName ||
      lead.rawName ||
      "Unknown company"
  );
}

function getScore(lead: Lead) {
  const raw =
    lead.aiIntentScore ||
    lead.intentScore ||
    lead.score ||
    lead.aiScore ||
    lead.confidenceScore ||
    0;

  const numberValue = Number(raw);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getSourceUrl(lead: Lead) {
  const raw =
    lead.sourceUrl ||
    lead.sourceURL ||
    lead.url ||
    lead.link ||
    lead.companyUrl ||
    lead.companyURL ||
    lead.jobUrl ||
    lead.eventUrl ||
    lead.website ||
    lead.source_link ||
    "";

  if (!raw || typeof raw !== "string") return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.includes(".") && !raw.includes(" ")) return `https://${raw}`;
  return "";
}

function getSourceName(lead: Lead) {
  const source =
    lead.sourceName ||
    lead.sourcePlatform ||
    lead.platform ||
    lead.sourceType ||
    lead.source ||
    "";

  if (!source || typeof source !== "string") return "Public signal";
  if (source.startsWith("http")) return "Public source";
  return compactText(source);
}

function getSourceType(lead: Lead) {
  return compactText(lead.sourceType || lead.signalType || lead.category || "").toLowerCase();
}

function getSignalText(lead: Lead) {
  return short(
    lead.signal ||
      lead.mentionTitle ||
      lead.description ||
      lead.homepageText ||
      lead.careersText ||
      lead.aiEvidence ||
      lead.evidence ||
      lead.reason ||
      "",
    220
  );
}

function getExistingText(lead: Lead, keys: string[]) {
  for (const key of keys) {
    const value = compactText(lead[key]);
    if (value) return value;
  }
  return "";
}

function isWeakCopy(text: string, company: string) {
  const lower = text.toLowerCase();
  if (!text) return true;
  if (text.length < 45) return true;
  if (lower.includes("no reason available")) return true;
  if (lower.includes("research the right buyer")) return true;
  if (lower.includes("prepare outbound messaging")) return true;
  if (lower.includes("based on available public signals") && !lower.includes(company.toLowerCase())) {
    return true;
  }
  return false;
}

function inferSignalCategory(lead: Lead) {
  const haystack = [
    getSourceType(lead),
    getSourceName(lead),
    getSignalText(lead),
    compactText(lead.jobTitle),
    compactText(lead.title),
    compactText(lead.description),
  ]
    .join(" ")
    .toLowerCase();

  if (/hiring|job|career|remote|engineer|sales|growth|marketing|revops|sdr|bdr/.test(haystack)) {
    return "hiring";
  }

  if (/conference|event|summit|sponsor|partner|exhibitor|saastr|web summit|mwc|shoptalk/.test(haystack)) {
    return "event";
  }

  if (/launch|product|yc|product hunt|startup|funding|seed|series/.test(haystack)) {
    return "launch";
  }

  return "general";
}

function getIcpFit(lead: Lead) {
  const existing = getExistingText(lead, [
    "aiIcpFit",
    "icpFit",
    "aiIcpReason",
    "icpReason",
    "aiBuyerNeed",
    "buyerNeed",
    "need",
  ]);

  const company = getCompanyName(lead);
  const category = inferSignalCategory(lead);

  if (existing && !isWeakCopy(existing, company)) {
    return sentence(existing);
  }

  if (category === "hiring") {
    return `${company} may fit because hiring or team-growth signals often create pressure to build repeatable pipeline, recruit revenue roles, or improve outbound execution.`;
  }

  if (category === "event") {
    return `${company} may fit because event, sponsor, or exhibitor activity usually means the team is investing in visibility, partnerships, and new pipeline creation.`;
  }

  if (category === "launch") {
    return `${company} may fit because launch, startup, or product activity can create a near-term need for market feedback, qualified conversations, and early customer pipeline.`;
  }

  return `${company} may fit if the current public signal connects to revenue growth, hiring, market expansion, or outbound pipeline needs.`;
}

function getWhyNow(lead: Lead) {
  const existing = getExistingText(lead, [
    "aiWhyNow",
    "whyNow",
    "reason",
    "aiReasoning",
    "why_now",
  ]);

  const company = getCompanyName(lead);
  const sourceName = getSourceName(lead);
  const signal = getSignalText(lead);
  const category = inferSignalCategory(lead);

  if (existing && !isWeakCopy(existing, company)) {
    return sentence(existing);
  }

  if (category === "hiring") {
    return `${company} is showing a fresh hiring or team-growth signal from ${sourceName}. That is a timely reason to reach out because companies adding roles often need more predictable lead generation, appointment-setting, or sales pipeline support.`;
  }

  if (category === "event") {
    return `${company} is visible in ${sourceName}, which suggests active GTM investment rather than a cold static account. Reference that event signal and connect it to pipeline, meetings, or partner/customer acquisition.`;
  }

  if (category === "launch") {
    return `${company} has a recent launch/startup signal from ${sourceName}. That creates a timely outreach angle around turning attention into qualified conversations, demos, or early customer pipeline.`;
  }

  if (signal) {
    return `${company} has a recent public signal from ${sourceName}: ${sentence(signal)} Use that specific trigger as the reason for outreach instead of sending a generic cold message.`;
  }

  return `${company} has a recent public activity signal from ${sourceName}. Use this as a timely reason to start a personalized outbound conversation now.`;
}

function getNextAction(lead: Lead) {
  const existing = getExistingText(lead, [
    "aiNextAction",
    "nextAction",
    "recommendedAction",
    "action",
    "next_action",
  ]);

  const company = getCompanyName(lead);
  const sourceName = getSourceName(lead);
  const score = getScore(lead);
  const category = inferSignalCategory(lead);

  if (existing && !isWeakCopy(existing, company)) {
    return sentence(existing);
  }

  if (category === "hiring") {
    return `Find the revenue, growth, or operations leader at ${company}. Open with the hiring signal from ${sourceName}, then ask if they are trying to turn new headcount into more qualified meetings or pipeline.`;
  }

  if (category === "event") {
    return `Reference ${company}'s presence in ${sourceName}. Ask the partnerships, marketing, or sales leader whether they want help converting that event visibility into booked conversations before and after the event.`;
  }

  if (category === "launch") {
    return `Reference ${company}'s recent launch/startup signal. Ask the founder or GTM lead if they are prioritizing early pipeline, customer discovery, or demo booking this month.`;
  }

  if (score >= 85) {
    return `Prioritize ${company} for same-day outreach. Use the source signal as the first line, then ask a direct question about pipeline or booked meetings.`;
  }

  if (score >= 70) {
    return `Research the likely buyer at ${company}, then send a warm outbound message tied to the ${sourceName} signal.`;
  }

  return `Manually review ${company}'s website and buyer team, then decide whether the ${sourceName} signal is strong enough for outreach or nurture.`;
}

export default function LeadsPage() {
  const [darkMode, setDarkMode] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadMeta, setLeadMeta] = useState<LeadMeta>(emptyMeta);
  const [activeFilter, setActiveFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [movingPage, setMovingPage] = useState<"prev" | "next" | "unlock" | null>(null);
  const [pageMessage, setPageMessage] = useState("Showing current 50-lead page");

  const pageClass = darkMode
    ? "relative min-h-screen overflow-hidden bg-[#070816] text-white"
    : "relative min-h-screen overflow-hidden bg-[#fff0bd] text-slate-950";

  const panelClass = darkMode
    ? "retro-box border-2 border-slate-800 bg-slate-950/90 shadow-[10px_10px_0_rgba(103,232,249,0.12)]"
    : "retro-box border-2 border-slate-950 bg-white/88 shadow-[10px_10px_0_rgba(139,92,246,0.22)]";

  const mutedText = darkMode ? "text-slate-400" : "text-slate-600";

  
function queueNextBatchPrefetch(meta: LeadMeta) {
  if (!meta || !meta.canUnlockNext) return;

  fetch("/api/prefetch-next-batch", {
    method: "POST",
  }).catch(() => {});
}

async function loadData() {
    setLoading(true);

    try {
      const leadResponse = await fetch(`/api/leads?ts=${Date.now()}`, { cache: "no-store" });
      const leadData = await leadResponse.json();

      if (!leadResponse.ok || leadData.ok === false) {
        throw new Error(leadData.error || "Failed to load leads");
      }

      setLeads(Array.isArray(leadData.leads) ? leadData.leads : []);
      const nextMeta = leadData.meta || emptyMeta; setLeadMeta(nextMeta); queueNextBatchPrefetch(nextMeta);
    } catch (error) {
      setLeads([]);
      setLeadMeta(emptyMeta);
      setPageMessage(error instanceof Error ? error.message : "Could not load leads");
    } finally {
      setLoading(false);
    }
  }

  async function postJson(url: string, body?: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Request failed: ${url}`);
    }

    return data;
  }

  async function movePage(direction: "prev" | "next") {
    setMovingPage(direction);
    setPageMessage(direction === "next" ? "Loading next 50 leads..." : "Loading previous 50 leads...");

    try {
      await postJson("/api/leads-page", { direction });
      await loadData();
      setPageMessage("Showing current 50-lead page");
    } catch (error) {
      setPageMessage(error instanceof Error ? error.message : "Page move failed");
    } finally {
      setMovingPage(null);
    }
  }

  async function unlockNext50() {
    setMovingPage("unlock");
    setPageMessage("Unlocking next 50 leads...");

    try {
      await postJson("/api/reveal-leads-next");
      await loadData();
      setPageMessage("Next 50 leads unlocked");
    } catch (error) {
      setPageMessage(error instanceof Error ? error.message : "Next 50 failed");
    } finally {
      setMovingPage(null);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (activeFilter === "all") return true;
      return getDecisionFilter(getDecision(lead)) === activeFilter;
    });
  }, [leads, activeFilter]);

  const counts = useMemo(() => {
    return {
      all: leads.length,
      hot: leads.filter((lead) => getDecisionFilter(getDecision(lead)) === "hot").length,
      warm: leads.filter((lead) => getDecisionFilter(getDecision(lead)) === "warm").length,
      nurture: leads.filter((lead) => getDecisionFilter(getDecision(lead)) === "nurture").length,
      review: leads.filter((lead) => getDecisionFilter(getDecision(lead)) === "review").length,
      excluded: leads.filter((lead) => getDecisionFilter(getDecision(lead)) === "excluded").length,
    };
  }, [leads]);

  const visiblePercent =
    leadMeta.totalAvailable > 0
      ? Math.round((leadMeta.visibleEnd / leadMeta.totalAvailable) * 100)
      : 0;

  const scoredPercent =
    leadMeta.visibleLeadCount > 0
      ? Math.round((leadMeta.scoredVisibleLeads / leadMeta.visibleLeadCount) * 100)
      : 0;

  return (
    <main className={pageClass}>
      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[340px_1fr]">
        <aside className={panelClass + " h-fit p-5"}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-600">
                LeadGrid
              </p>
              <h1 className="mt-2 text-3xl font-black">Reviewed Leads</h1>
            </div>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={
                darkMode
                  ? "grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-slate-900 text-lg"
                  : "grid h-10 w-10 place-items-center rounded-full border border-slate-950/10 bg-white/80 text-lg"
              }
              aria-label="Toggle color mode"
            >
              {darkMode ? "☀" : "☾"}
            </button>
          </div>

          <div className="mt-5 flex gap-3">
            <Link
              href="/console"
              className="retro-box flex-1 bg-slate-950 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-white"
            >
              Run Console
            </Link>
            <a
              href="/api/leads-csv"
              className="retro-box flex-1 bg-white px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-slate-950"
            >
              CSV
            </a>
          </div>

          <section className="mt-6">
            <h2 className="text-sm font-black uppercase tracking-[0.16em]">Queue Controls</h2>
            <button
              onClick={() => {
                if (!loading && leadMeta.canUnlockNext && movingPage === null) {
                  unlockNext50();
                }
              }}
              disabled={loading || !leadMeta.canUnlockNext || movingPage !== null}
              className={
                loading || !leadMeta.canUnlockNext || movingPage !== null
                  ? "retro-box mt-5 w-full bg-slate-950 px-8 py-5 text-sm font-black uppercase tracking-[0.16em] text-white opacity-50 shadow-[8px_8px_0_rgba(139,92,246,0.65)]"
                  : "retro-box mt-5 w-full bg-slate-950 px-8 py-5 text-sm font-black uppercase tracking-[0.16em] text-white shadow-[8px_8px_0_rgba(139,92,246,0.65)] transition hover:-translate-y-1"
              }
            >
              {loading
                ? "Loading"
                : !leadMeta.canUnlockNext
                  ? "All Done"
                  : movingPage === "unlock"
                    ? "Loading"
                    : "Next 50"}
            </button>
            <p className={"mt-3 text-sm " + mutedText}>
              {leadMeta.canUnlockNext
                ? `Next up: ${leadMeta.nextStart}-${leadMeta.nextEnd}`
                : "All leads unlocked"}
            </p>
            <p className={"mt-2 text-xs " + mutedText}>{pageMessage}</p>
          </section>

          <section className="mt-6">
            <h2 className="text-sm font-black uppercase tracking-[0.16em]">Lead Coverage</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {[
                { label: "Visible", value: leadMeta.visibleLeadCount },
                { label: "Scored", value: leadMeta.scoredVisibleLeads },
                { label: "Left", value: leadMeta.hiddenLeft },
                { label: "Total", value: leadMeta.totalAvailable },
              ].map((stat) => (
                <div key={stat.label} className="retro-box bg-white/70 p-3 text-slate-950">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em]">
                    {stat.label}
                  </p>
                  <p className="mt-1 text-2xl font-black">{stat.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-3">
              {[
                { label: "Queue viewed", value: visiblePercent },
                { label: "Scored on this page", value: scoredPercent },
              ].map((bar) => (
                <div key={bar.label}>
                  <div className="mb-1 flex justify-between text-xs font-bold">
                    <span>{bar.label}</span>
                    <span>{bar.value}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-slate-950"
                      style={{ width: `${Math.max(Math.min(bar.value, 100), 0)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-sm font-black uppercase tracking-[0.16em]">
              Filters on this page
            </h2>
            <div className="mt-3 grid gap-2">
              {filters.map((filter) => (
                <button
                  key={filter.key}
                  onClick={() => setActiveFilter(filter.key)}
                  className={
                    activeFilter === filter.key
                      ? "retro-box flex items-center justify-between bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white"
                      : darkMode
                        ? "retro-box flex items-center justify-between border-2 border-slate-800 bg-slate-950/80 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-300"
                        : "retro-box flex items-center justify-between border-2 border-slate-950 bg-white/80 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-950"
                  }
                >
                  <span>{filter.label}</span>
                  <span>{counts[filter.key as keyof typeof counts] ?? 0}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className={panelClass + " p-5"}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black">Lead Card</h2>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (leadMeta.canGoPrev && movingPage === null) movePage("prev");
                }}
                disabled={!leadMeta.canGoPrev || movingPage !== null}
                className={
                  !leadMeta.canGoPrev || movingPage !== null
                    ? "retro-box bg-slate-950 px-4 py-3 text-lg font-black text-white opacity-40"
                    : "retro-box bg-slate-950 px-4 py-3 text-lg font-black text-white transition hover:-translate-y-1"
                }
              >
                ←
              </button>
              <div className="text-center text-xs font-black uppercase tracking-[0.14em]">
                <p>Range</p>
                <p>
                  {leadMeta.visibleStart}-{leadMeta.visibleEnd}
                </p>
              </div>
              <button
                onClick={() => {
                  if (leadMeta.canGoNext && movingPage === null) movePage("next");
                }}
                disabled={!leadMeta.canGoNext || movingPage !== null}
                className={
                  !leadMeta.canGoNext || movingPage !== null
                    ? "retro-box bg-slate-950 px-4 py-3 text-lg font-black text-white opacity-40"
                    : "retro-box bg-slate-950 px-4 py-3 text-lg font-black text-white transition hover:-translate-y-1"
                }
              >
                →
              </button>
            </div>
          </div>

          {loading && (
            <div className="retro-box mt-6 bg-white/80 p-6 text-slate-950">
              Loading reviewed leads...
            </div>
          )}

          {!loading && filteredLeads.length === 0 && (
            <div className="retro-box mt-6 bg-white/80 p-6 text-slate-950">
              <h3 className="text-xl font-black">No leads found in this filter.</h3>
              <p className="mt-2 text-sm">
                Try another filter, run review from the console, or unlock the next 50 leads.
              </p>
            </div>
          )}

          <div className="mt-6 grid gap-4">
            {!loading &&
              filteredLeads.map((lead, index) => {
                const decision = getDecision(lead);
                const score = getScore(lead);
                const sourceUrl = getSourceUrl(lead);
                const sourceName = getSourceName(lead);

                return (
                  <article
                    key={`${getCompanyName(lead)}-${sourceName}-${index}`}
                    className={
                      darkMode
                        ? "retro-box border border-slate-800 bg-slate-900 p-5 transition hover:-translate-y-1 hover:border-cyan-300"
                        : "retro-box border border-slate-300 bg-white p-5 transition hover:-translate-y-1 hover:border-violet-500"
                    }
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-600">
                          {getDecisionLabel(decision)}
                        </p>
                        <h3 className="mt-2 text-2xl font-black">{getCompanyName(lead)}</h3>
                        <p className={"mt-1 text-sm " + mutedText}>
                          Source: {sourceName}{" "}
                          {sourceUrl ? (
                            <a
                              className="font-bold underline"
                              href={sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open source ↗
                            </a>
                          ) : (
                            "Source unavailable"
                          )}
                        </p>
                      </div>

                      <div className="retro-box bg-slate-950 px-4 py-3 text-center text-white">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em]">
                          Score
                        </p>
                        <p className="text-2xl font-black">{score}</p>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-600">
                          Why now
                        </p>
                        <p className="mt-2 text-sm leading-6">{getWhyNow(lead)}</p>
                      </div>

                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-600">
                          ICP Fit
                        </p>
                        <p className="mt-2 text-sm leading-6">{getIcpFit(lead)}</p>
                      </div>

                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-600">
                          Next action
                        </p>
                        <p className="mt-2 text-sm leading-6">{getNextAction(lead)}</p>
                      </div>
                    </div>
                  </article>
                );
              })}
          </div>
        </section>
      </div>
    </main>
  );
}
