"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

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
  candidateTotal: number;
  pendingReview: number;
  reviewedPercent: number;
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
  candidateTotal: 0,
  pendingReview: 0,
  reviewedPercent: 0,
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
  return sentence(
    getExistingText(lead, [
      "aiIcpFit",
      "icpFit",
    ])
  );
}


function getWhyNow(lead: Lead) {
  return sentence(
    getExistingText(lead, [
      "aiWhyNow",
      "whyNow",
      "why_now",
    ])
  );
}


function getNextAction(lead: Lead) {
  return sentence(
    getExistingText(lead, [
      "aiNextAction",
      "nextAction",
      "recommendedAction",
      "action",
      "next_action",
    ])
  );
}


export default function LeadsPage() {
  const [darkMode, setDarkMode] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadMeta, setLeadMeta] = useState<LeadMeta>(emptyMeta);
  const [activeFilter, setActiveFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [movingPage, setMovingPage] = useState<"prev" | "next" | "unlock" | null>(null);
  const [pageMessage, setPageMessage] = useState("Showing current 50-lead page");
  const [prefetchStatus, setPrefetchStatus] = useState("");
  const [reviewProgress, setReviewProgress] = useState(0);
  const prefetchQueuedRef = useRef(false);

  const pageClass = darkMode
    ? "relative min-h-screen overflow-hidden bg-[#070816] text-white"
    : "relative min-h-screen overflow-hidden bg-[#fff0bd] text-slate-950";

  const panelClass = darkMode
    ? "retro-box border-2 border-slate-800 bg-slate-950/90 shadow-[10px_10px_0_rgba(103,232,249,0.12)]"
    : "retro-box border-2 border-slate-950 bg-white/88 shadow-[10px_10px_0_rgba(139,92,246,0.22)]";

  const mutedText = darkMode ? "text-slate-400" : "text-slate-600";

  async function maybePrefetchNextBatch(_meta: LeadMeta) {
    // Background prefetch disabled to keep paging/state simple and reliable.
    return;
  }

  async function loadData(allowPrefetch = true) {
    setLoading(true);

    try {
      const leadResponse = await fetch(`/api/leads?ts=${Date.now()}`, {
        cache: "no-store",
      });

      const leadData = await leadResponse.json();

      if (!leadResponse.ok || leadData.ok === false) {
        throw new Error(leadData.error || "Failed to load leads");
      }

      const nextLeads = Array.isArray(leadData.leads) ? leadData.leads : [];
      const nextMeta = leadData.meta || emptyMeta;

      setLeads(nextLeads);
      setLeadMeta(nextMeta);
      setPageMessage("Showing current 50-lead page");

      if (allowPrefetch) maybePrefetchNextBatch(nextMeta);
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
      throw new Error(data.error || data.logs || `Request failed: ${url}`);
    }

    return data;
  }

  async function movePage(direction: "prev" | "next") {
    if (movingPage) return;

    setMovingPage(direction);
    setPageMessage(direction === "next" ? "Loading next page..." : "Loading previous page...");

    try {
      await postJson("/api/leads-page", { direction });
      await loadData();
    } catch (error) {
      setPageMessage(error instanceof Error ? error.message : "Page move failed");
    } finally {
      setMovingPage(null);
    }
  }

  async function unlockNext50() {
    if (movingPage) return;

    setMovingPage("unlock");
    setReviewProgress(5);
    setPrefetchStatus("");
    setPageMessage(
      leadMeta.totalAvailable <= 0
        ? "LLM is reviewing the first 50 companies. Please wait..."
        : "LLM is reviewing the next 50 companies. Please wait..."
    );

    let timer: ReturnType<typeof setInterval> | null = null;

    try {
      timer = setInterval(() => {
        setReviewProgress((value) => {
          if (value >= 92) return value;
          return value + 4;
        });
      }, 900);

      await postJson("/api/reveal-leads-next");

      setReviewProgress(100);
      await loadData(false);
      setPageMessage("LLM review complete. Showing reviewed leads.");
    } catch (error) {
      setPageMessage(error instanceof Error ? error.message : "Next 50 failed");
    } finally {
      if (timer) clearInterval(timer);

      setTimeout(() => {
        setMovingPage(null);
        setReviewProgress(0);
      }, 600);
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

  const reviewedPercent = leadMeta.reviewedPercent || 0;

  const scoredPercent =
    leadMeta.visibleLeadCount > 0
      ? Math.round((leadMeta.scoredVisibleLeads / leadMeta.visibleLeadCount) * 100)
      : 0;

  const llmProgressPercent = movingPage === "unlock" ? reviewProgress : reviewedPercent;

  return (
    <main className={pageClass}>

      <div
        className="pointer-events-none fixed inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(15,23,42,0.28) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.28) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <nav
        className={
          darkMode
            ? "sticky top-0 z-20 border-b border-white/10 bg-[#070816]/90 backdrop-blur"
            : "sticky top-0 z-20 border-b border-slate-950/10 bg-[#fff0bd]/90 backdrop-blur"
        }
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/landing-page" className="text-xl font-black tracking-tight">
            LeadGrid
          </Link>

          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em]">
            <Link className="rounded-full px-4 py-2 hover:bg-white/60" href="/landing-page">
              Home
            </Link>
            <Link className="rounded-full px-4 py-2 hover:bg-white/60" href="/console">
              Console
            </Link>
            <Link className="rounded-full bg-slate-950 px-4 py-2 text-white" href="/leads">
              Leads
            </Link>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={
                darkMode
                  ? "ml-2 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-slate-900 text-lg"
                  : "ml-2 grid h-9 w-9 place-items-center rounded-full border border-slate-950/10 bg-white/80 text-lg"
              }
              aria-label="Toggle color mode"
            >
              {darkMode ? "☀" : "☾"}
            </button>
          </div>
        </div>
      </nav>

      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[320px_1fr]">
        <aside className={panelClass + " h-fit p-5"}>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-600">
              LeadGrid
            </p>
            <h1 className="mt-2 text-3xl font-black">Reviewed Leads</h1>
            <p className={"mt-2 text-sm " + mutedText}>
              Showing {leadMeta.visibleStart}-{leadMeta.visibleEnd} of {leadMeta.totalAvailable}
            </p>
          </div>

          <section className="mt-6">
            <h2 className="text-sm font-black uppercase tracking-[0.16em]">Queue Controls</h2>

            <div className="mt-4 grid gap-3">
              <button
                onClick={() => {
                  if (!loading && movingPage === null) {
                    unlockNext50();
                  }
                }}
                disabled={loading || movingPage !== null}
                className={
                  loading || !leadMeta.canUnlockNext || movingPage !== null
                    ? "retro-box w-full bg-slate-950 px-6 py-4 text-sm font-black uppercase tracking-[0.16em] text-white opacity-50 shadow-[8px_8px_0_rgba(139,92,246,0.65)]"
                    : "retro-box w-full bg-slate-950 px-6 py-4 text-sm font-black uppercase tracking-[0.16em] text-white shadow-[8px_8px_0_rgba(139,92,246,0.65)] transition hover:-translate-y-1"
                }
              >
                {loading
                  ? "LLM Reviewing..."
                  : leadMeta.pendingReview <= 0 && !leadMeta.canUnlockNext
                    ? "All Done"
                    : movingPage === "unlock"
                      ? "LLM Reviewing..."
                      : "Next 50"}
              </button>

              <a
                href={`/api/leads-csv?ts=${Date.now()}`}
                className="retro-box w-full bg-white px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-slate-950 transition hover:-translate-y-1"
              >
                Download CSV
              </a>
            </div>

            <p className={"mt-3 text-sm " + mutedText}>
              {leadMeta.canUnlockNext
                ? `Next up: ${leadMeta.nextStart}-${leadMeta.nextEnd}`
                : "All leads unlocked"}
            </p>
            <p className={"mt-2 text-xs " + mutedText}>{pageMessage}</p>
            {prefetchStatus ? (
              <p className={"mt-2 text-xs " + mutedText}>{prefetchStatus}</p>
            ) : null}
          </section>

          <section className="mt-6">
            <h2 className="text-sm font-black uppercase tracking-[0.16em]">Lead Coverage</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {[
                { label: "Visible", value: leadMeta.visibleLeadCount },
                { label: "Reviewed", value: leadMeta.totalAvailable },
                { label: "Pending", value: leadMeta.pendingReview },
                { label: "Candidates", value: leadMeta.candidateTotal },
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
                {
                  label:
                    movingPage === "unlock"
                      ? "LLM review running"
                      : "LLM reviewed",
                  value: llmProgressPercent,
                },
                { label: "Scored on this page", value: scoredPercent },
              ].map((bar) => (
                <div key={bar.label}>
                  <div className="mb-1 flex justify-between text-xs font-bold">
                    <span>{bar.label}</span>
                    <span>{bar.value}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200">
                    <div
                      className={movingPage === "unlock" && bar.label === "LLM review running" ? "h-2 animate-pulse rounded-full bg-slate-950 transition-all" : "h-2 rounded-full bg-slate-950 transition-all"}
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

        <section className={panelClass + " flex min-h-[calc(100vh-120px)] flex-col p-5"}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black">Lead Card</h2>
              <p className={"mt-1 text-sm " + mutedText}>
                Scroll inside this panel. Current range: {leadMeta.visibleStart}-{leadMeta.visibleEnd}
              </p>
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

              <div className="min-w-[100px] text-center text-xs font-black uppercase tracking-[0.14em]">
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

          <div className="mt-5 flex-1 overflow-hidden">
            {loading && (
              <div className="retro-box bg-white/80 p-6 text-slate-950">
                Loading reviewed leads...
              </div>
            )}

            {!loading && filteredLeads.length === 0 && (
              <div className="retro-box bg-white/80 p-6 text-slate-950">
                <h3 className="text-xl font-black">No leads found in this filter.</h3>
                <p className="mt-2 text-sm">
                  Try another filter, run review from the console, or unlock the next 50 leads.
                </p>
              </div>
            )}

            {!loading && filteredLeads.length > 0 && (
              <div className="max-h-[calc(100vh-250px)] overflow-y-auto pr-3">
                <div className="grid gap-4">
                  {filteredLeads.map((lead, index) => {
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
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
