"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Stage =
  | "idle"
  | "scanning"
  | "extracted"
  | "precleaning"
  | "precleaned"
  | "reviewing"
  | "reviewed";

type SourceState = "waiting" | "scanning" | "done";

const sources = [
  { name: "Remote OK", type: "Remote jobs" },
  { name: "Arbeitnow", type: "Hiring signals" },
  { name: "Remotive", type: "Remote companies" },
  { name: "Jobicy", type: "Job posts" },
  { name: "Web Summit", type: "Event companies" },
  { name: "SaaStr", type: "B2B event signals" },
  { name: "Adzuna", type: "Market activity" },
];

const reviewSteps = [
  "ICP fit",
  "Buyer need",
  "Signal strength",
  "Confidence",
  "Why now",
  "Next action",
];

export default function ConsolePage() {
  const [darkMode, setDarkMode] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [sourceStates, setSourceStates] = useState<Record<string, SourceState>>(
    () => Object.fromEntries(sources.map((source) => [source.name, "waiting"]))
  );
  const [logs, setLogs] = useState<string[]>([
    "system ready",
    "waiting for signal scan",
  ]);
  const [scanProgress, setScanProgress] = useState(0);
  const [activeProgress, setActiveProgress] = useState(0);
  const [pipelineTitle, setPipelineTitle] = useState("Processing Queue");
  const [pipelineItems, setPipelineItems] = useState<
    { label: string; status: "waiting" | "running" | "done" }[]
  >([{ label: "Waiting for signal scan", status: "waiting" }]);

  const [extractionCounts, setExtractionCounts] = useState({
    rawMentions: 0,
    sourcesScanned: 0,
    uniqueCompanies: 0,
    junkRows: 0,
  });

  const [precleanCounts, setPrecleanCounts] = useState({
    acceptedMentions: 0,
    rejectedRows: 0,
    companiesReady: 0,
  });
  const [status, setStatus] = useState<{
    visibleAiCompanies?: number;
    prefetchedAiCompanies?: number;
    pendingAiCompanies?: number;
    readyToRevealCount?: number;
    nextBatchStart?: number;
    nextBatchEnd?: number;
  } | null>(null);
  const [apiLoading, setApiLoading] = useState(false);

  const pageClass = darkMode
    ? "relative min-h-screen overflow-hidden bg-[#070816] text-white"
    : "relative min-h-screen overflow-hidden bg-[#fff0bd] text-slate-950";

  const panelClass = darkMode
    ? "retro-box border-2 border-slate-800 bg-slate-950/90 shadow-[10px_10px_0_rgba(103,232,249,0.12)]"
    : "retro-box border-2 border-slate-950 bg-white/88 shadow-[10px_10px_0_rgba(139,92,246,0.22)]";

  const mutedText = darkMode ? "text-slate-400" : "text-slate-600";


  function pushLog(line: string) {
    setLogs((current) => [...current.slice(-8), line]);
  }


  async function runPipelineStep(step: string) {
    const response = await fetch("/api/run-pipeline-step", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ step }),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || `${step} failed`);
    }

    return data;
  }

  function updatePipelineItem(
    label: string,
    status: "waiting" | "running" | "done"
  ) {
    setPipelineItems((items) =>
      items.map((item) => (item.label === label ? { ...item, status } : item))
    );
  }

  function countTowards(
    setter: React.Dispatch<React.SetStateAction<any>>,
    key: string,
    target: number,
    duration = 900
  ) {
    const steps = 18;
    let currentStep = 0;

    const interval = window.setInterval(() => {
      currentStep += 1;
      const nextValue = Math.round((target * currentStep) / steps);

      setter((current: any) => ({
        ...current,
        [key]: Math.min(nextValue, target),
      }));

      if (currentStep >= steps) {
        window.clearInterval(interval);
      }
    }, duration / steps);
  }

  async function startScan() {
    setStage("scanning");
    setScanProgress(0);
    setActiveProgress(0);
    setApiLoading(true);
    setStatus(null);

    setExtractionCounts({
      rawMentions: 0,
      sourcesScanned: 0,
      uniqueCompanies: 0,
      junkRows: 0,
    });

    setPrecleanCounts({
      acceptedMentions: 0,
      rejectedRows: 0,
      companiesReady: 0,
    });

    const steps = [
      { apiStep: "collect_sources", label: "Jobs", log: "> jobs", progress: 35 },
      { apiStep: "collect_extra", label: "Web", log: "> web", progress: 68 },
      { apiStep: "collect_saas", label: "Events", log: "> events", progress: 100 },
    ];

    setLogs([
      "> scan started",
      "> checking live sources",
    ]);

    setPipelineTitle("Signal Scan");
    setPipelineItems(
      steps.map((step, index) => ({
        label: step.label,
        status: index === 0 ? "running" : "waiting",
      }))
    );

    try {
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];

        setLogs((current) => [...current, step.log]);
        updatePipelineItem(step.label, "running");

        const data = await runPipelineStep(step.apiStep);

        updatePipelineItem(step.label, "done");
        setActiveProgress(step.progress);
        setScanProgress(step.progress);

        setExtractionCounts({
          rawMentions: Number(data.sourceStats?.rawMentions || 0),
          sourcesScanned: Number(data.sourceStats?.sourcesScanned || 0),
          uniqueCompanies: Number(data.sourceStats?.uniqueCompanies || 0),
          junkRows: 0,
        });

        setLogs((current) => [
          ...current,
          ...((data.logs || []).map((line: string) => `> ✓ ${line}`)),
          `> mentions: ${data.sourceStats?.rawMentions || 0}`,
          `> companies: ${data.sourceStats?.uniqueCompanies || 0}`,
        ]);

        if (index + 1 < steps.length) {
          updatePipelineItem(steps[index + 1].label, "running");
        }
      }

      setStage("extracted");
      setLogs((current) => [...current, "> scan complete"]);
    } catch (error) {
      setLogs((current) => [
        ...current,
        `> scan failed: ${error instanceof Error ? error.message : "unknown error"}`,
      ]);
    } finally {
      setApiLoading(false);
    }
  }

  async function startPrecleaning() {
    setStage("precleaning");
    setActiveProgress(0);
    setApiLoading(true);

    setPrecleanCounts({
      acceptedMentions: 0,
      rejectedRows: 0,
      companiesReady: 0,
    });

    const steps = [
      { label: "Read", progress: 25 },
      { label: "Clean", progress: 55 },
      { label: "Accept", progress: 80 },
      { label: "Ready", progress: 100 },
    ];

    setLogs((current) => [
      ...current,
      "> clean started",
      "> removing noise",
    ]);

    setPipelineTitle("Pre-Clean");
    setPipelineItems(
      steps.map((step, index) => ({
        label: step.label,
        status: index === 0 ? "running" : "waiting",
      }))
    );

    const visualTimer = window.setInterval(() => {
      setActiveProgress((value) => Math.min(value + 3, 88));
    }, 350);

    try {
      const data = await runPipelineStep("preclean");

      window.clearInterval(visualTimer);

      for (const step of steps) {
        updatePipelineItem(step.label, "done");
        setActiveProgress(step.progress);
      }

      setPrecleanCounts({
        acceptedMentions: Number(data.precleanStats?.acceptedMentions || 0),
        rejectedRows: Number(data.precleanStats?.rejectedRows || 0),
        companiesReady: Number(data.precleanStats?.companiesReady || 0),
      });

      setStage("precleaned");

      setLogs((current) => [
        ...current,
        "> clean complete",
        ...((data.logs || []).map((line: string) => `> ✓ ${line}`)),
        `> accepted: ${data.precleanStats?.acceptedMentions || 0}`,
        `> rejected: ${data.precleanStats?.rejectedRows || 0}`,
        `> ready: ${data.precleanStats?.companiesReady || 0}`,
      ]);
    } catch (error) {
      window.clearInterval(visualTimer);

      setLogs((current) => [
        ...current,
        `> clean failed: ${error instanceof Error ? error.message : "unknown error"}`,
      ]);
    } finally {
      setApiLoading(false);
    }
  }

  async function loadReviewStatus() {
    setStage("reviewing");
    setApiLoading(true);
    setActiveProgress(0);

    const steps = [
      { label: "Review", progress: 60 },
      { label: "Score", progress: 75 },
      { label: "Queue", progress: 90 },
      { label: "Ready", progress: 100 },
    ];

    setLogs((current) => [
      ...current,
      "> review started",
      "> scoring fit and intent",
    ]);

    setPipelineTitle("Intent Score");
    setPipelineItems(
      steps.map((step, index) => ({
        label: step.label,
        status: index === 0 ? "running" : "waiting",
      }))
    );

    const visualTimer = window.setInterval(() => {
      setActiveProgress((value) => Math.min(value + 2, 88));
    }, 700);

    try {
      const data = await runPipelineStep("qualify");

      window.clearInterval(visualTimer);

      for (const step of steps) {
        updatePipelineItem(step.label, "done");
        setActiveProgress(step.progress);
      }

      setStatus(data);
      setStage("reviewed");

      setLogs((current) => [
        ...current,
        "> review complete",
        ...((data.logs || []).map((line: string) => `> ✓ ${line}`)),
        `> reviewed: ${data.qualificationStats?.reviewedCompanies || 0}`,
        `> first page: ${data.qualificationStats?.visibleLeads || 0}`,
        `> queue: ${data.qualificationStats?.totalLeads || 0}`,
      ]);
    } catch (error) {
      window.clearInterval(visualTimer);

      setLogs((current) => [
        ...current,
        `> review failed: ${error instanceof Error ? error.message : "unknown error"}`,
      ]);
    } finally {
      setApiLoading(false);
    }
  }

  async function revealNextBatch() {
    setApiLoading(true);
    pushLog("> revealing next reviewed lead batch");

    try {
      await fetch("/api/enrich-next-batch", {
        method: "POST",
      });

      const response = await fetch("/api/enrichment-status", { cache: "no-store" });
      const data = await response.json();
      setStatus(data);
      pushLog("> next 50 reviewed leads revealed");
    } catch {
      pushLog("> reveal action failed, dashboard can still be opened");
    } finally {
      setApiLoading(false);
    }
  }

  return (
    <main className={pageClass}>
      <style>{`
        @keyframes scanLine {
          0% { transform: translateY(-100%); opacity: 0; }
          30% { opacity: 0.22; }
          100% { transform: translateY(100%); opacity: 0; }
        }

        @keyframes pulsePixel {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.18); }
        }

        .retro-font {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        }

        .retro-box {
          clip-path: polygon(
            0 0,
            calc(100% - 12px) 0,
            calc(100% - 12px) 12px,
            100% 12px,
            100% 100%,
            12px 100%,
            12px calc(100% - 12px),
            0 calc(100% - 12px)
          );
        }

        .scan-panel::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.16), transparent);
          animation: scanLine 4s linear infinite;
          pointer-events: none;
        }

        .pulse-pixel {
          animation: pulsePixel 1.4s ease-in-out infinite;
        }
      `}</style>

      <div className="pointer-events-none absolute inset-0 z-0">
        <div
          className={
            darkMode
              ? "absolute inset-0 opacity-[0.13] [background-image:linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] [background-size:34px_34px]"
              : "absolute inset-0 opacity-[0.26] [background-image:linear-gradient(to_right,#111827_1px,transparent_1px),linear-gradient(to_bottom,#111827_1px,transparent_1px)] [background-size:34px_34px]"
          }
        />
        <div className="absolute right-[-160px] top-[-160px] h-[520px] w-[520px] rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute bottom-[-180px] left-[-160px] h-[560px] w-[560px] rounded-full bg-violet-500/18 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-5 py-6 md:px-10">
        <nav
          className={
            darkMode
              ? "sticky top-4 z-50 flex items-center justify-between gap-4 rounded-full border border-white/10 bg-slate-950/82 px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur-xl"
              : "sticky top-4 z-50 flex items-center justify-between gap-4 rounded-full border border-slate-950/10 bg-[#fff7dc]/86 px-4 py-3 shadow-2xl shadow-amber-950/10 backdrop-blur-xl"
          }
        >
          <Link href="/landing-page" className="flex items-center gap-3">
            <span className="grid h-11 w-11 grid-cols-2 gap-0.5 rounded-xl border-2 border-slate-950 bg-slate-950 p-1 shadow-[4px_4px_0_rgba(139,92,246,0.55)]">
              <span className="bg-violet-400" />
              <span className="bg-cyan-300" />
              <span className="bg-emerald-300" />
              <span className="bg-amber-300" />
            </span>
            <span>
              <span className="retro-font block text-xl font-black uppercase tracking-[-0.08em]">
                LeadGrid
              </span>
              <span className={`block text-[10px] font-black uppercase tracking-[0.18em] ${mutedText}`}>
                Signal Run Console
              </span>
            </span>
          </Link>

          <div className="hidden items-center gap-7 md:flex">
            <a href="#run" className={`retro-font text-xs font-black uppercase tracking-[0.16em] ${mutedText}`}>
              Run Console
            </a>
            <a href="#source-scan" className={`retro-font text-xs font-black uppercase tracking-[0.16em] ${mutedText}`}>
              Sources
            </a>
            <Link href="/leads" className={`retro-font text-xs font-black uppercase tracking-[0.16em] ${mutedText}`}>
              Lead Queue
            </Link>
          </div>

          <div className="flex items-center gap-2">
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

            <Link
              href="/leads"
              className="rounded-full bg-slate-950 px-5 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-white shadow-[4px_4px_0_rgba(139,92,246,0.6)]"
            >
              Lead Queue
            </Link>
          </div>
        </nav>

        <section id="run" className="grid gap-8 py-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <p className="retro-font text-sm font-black uppercase tracking-[0.24em] text-violet-600">
              Live lead machine
            </p>
            <h1 className="mt-5 text-5xl font-black tracking-tight md:text-7xl">
              Build a lead queue from public signals.
            </h1>
            <p className={`mt-6 max-w-2xl text-lg leading-8 ${mutedText}`}>
              Start a guided run. Watch LeadGrid scan public sources, extract raw mentions,
              clean obvious noise, review company intent, and reveal a ranked outbound queue.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              {stage === "idle" && (
                <button
                  onClick={startScan}
                  className="retro-box bg-slate-950 px-8 py-4 text-sm font-black uppercase tracking-[0.16em] text-white shadow-[8px_8px_0_rgba(139,92,246,0.65)] transition hover:-translate-y-1"
                >
                  Start Signal Scan
                </button>
              )}

              {stage === "extracted" && (
                <button
                  onClick={startPrecleaning}
                  className="retro-box bg-slate-950 px-8 py-4 text-sm font-black uppercase tracking-[0.16em] text-white shadow-[8px_8px_0_rgba(103,232,249,0.55)] transition hover:-translate-y-1"
                >
                  Send to Pre-Cleaning
                </button>
              )}

              {stage === "precleaned" && (
                <div>
                  <button
                    onClick={loadReviewStatus}
                    className="retro-box bg-slate-950 px-8 py-4 text-sm font-black uppercase tracking-[0.16em] text-white shadow-[8px_8px_0_rgba(52,211,153,0.55)] transition hover:-translate-y-1"
                  >
                    Qualify Companies for Sales Intent
                  </button>

                  <p className={`mt-3 max-w-2xl text-sm leading-6 ${mutedText}`}>
                    <span className="font-black">*</span> ICP fit here means companies that look useful
                    for a B2B outbound / appointment-setting offer. We separate them by public signals:
                    hiring activity, growth movement, startup/event presence, market activity,
                    likely sales-team need, urgency, signal strength, and confidence.
                  </p>
                </div>
              )}

              {stage === "reviewed" && (
                <div className={darkMode ? "retro-box border-2 border-cyan-300/40 bg-slate-950/90 p-5" : "retro-box border-2 border-slate-950 bg-white/85 p-5"}>
                  <p className="retro-font text-xs font-black uppercase tracking-[0.18em] text-cyan-600">
                    Qualification Complete
                  </p>
                  <h3 className="mt-2 text-2xl font-black">
                    Reviewed lead queue is ready.
                  </h3>
                  <p className={`mt-2 text-sm leading-6 ${mutedText}`}>
                    Companies have been separated by ICP fit, public signal strength,
                    urgency, confidence, and recommended next action.
                  </p>

                  <Link
                    href="/leads"
                    className="retro-box mt-5 inline-block bg-slate-950 px-8 py-4 text-sm font-black uppercase tracking-[0.16em] text-white shadow-[8px_8px_0_rgba(139,92,246,0.65)] transition hover:-translate-y-1"
                  >
                    Reveal
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className={`${panelClass} scan-panel relative min-h-[560px] overflow-hidden p-6 lg:sticky lg:top-28`}>
            <div className="mb-5 flex items-center justify-between border-b border-slate-500/30 pb-4">
              <div>
                <p className="retro-font text-xs font-black uppercase tracking-[0.2em] text-cyan-500">
                  Console Log
                </p>
                <h2 className="mt-1 text-3xl font-black">Signal Run</h2>
              </div>

              <span className="pulse-pixel h-4 w-4 bg-emerald-300 shadow-[0_0_22px_rgba(52,211,153,0.9)]" />
            </div>

            <div className="max-h-[220px] space-y-3 overflow-y-auto pr-2 font-mono text-sm">
              {logs.map((log, index) => (
                <div
                  key={`${log}-${index}`}
                  className={darkMode ? "bg-slate-900 p-3 text-slate-300" : "bg-slate-100 p-3 text-slate-700"}
                >
                  <span className="text-cyan-500">&gt;</span> {log.replace(/^> /, "")}
                </div>
              ))}
            </div>

            <div id="source-scan" className="mt-6 border-t border-slate-500/30 pt-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="retro-font text-xs font-black uppercase tracking-[0.18em] text-violet-600">
                  {pipelineTitle}
                </p>
                <p className={`text-xs font-black uppercase tracking-[0.14em] ${mutedText}`}>
                  live step-by-step
                </p>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {pipelineItems.map((item) => (
                  <div
                    key={item.label}
                    className={darkMode ? "flex items-center justify-between bg-slate-900 px-3 py-2 text-sm" : "flex items-center justify-between bg-slate-100 px-3 py-2 text-sm"}
                  >
                    <span className="font-bold">{item.label}</span>
                    <span
                      className={
                        item.status === "done"
                          ? "grid h-6 w-6 place-items-center bg-emerald-300 text-xs font-black text-slate-950"
                          : item.status === "running"
                          ? "pulse-pixel h-4 w-4 bg-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.9)]"
                          : "h-4 w-4 border-2 border-slate-400"
                      }
                    >
                      {item.status === "done" ? "✓" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-xs font-black uppercase tracking-[0.16em]">
                <span>{pipelineTitle.includes("Pre-Cleaning") ? "Pre-Cleaning Progress" : pipelineTitle.includes("Sales") ? "Qualification Progress" : "Extraction Progress"}</span>
                <span>{activeProgress}%</span>
              </div>
              <div className={darkMode ? "h-4 border-2 border-slate-700 bg-slate-900" : "h-4 border-2 border-slate-950 bg-white"}>
                <div
                  className="h-full bg-cyan-300 transition-all duration-700"
                  style={{ width: `${activeProgress}%` }}
                />
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-4">
              {[
                { label: "Raw", value: extractionCounts.rawMentions },
                { label: "Sources", value: extractionCounts.sourcesScanned },
                { label: "Companies", value: extractionCounts.uniqueCompanies },
                { label: "Noise", value: extractionCounts.junkRows },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className={darkMode ? "border border-slate-800 bg-slate-900 p-3" : "border border-slate-300 bg-slate-100 p-3"}
                >
                  <p className={`retro-font text-[10px] font-black uppercase tracking-[0.14em] ${mutedText}`}>
                    {stat.label}
                  </p>
                  <p className="mt-1 text-2xl font-black">{stat.value}</p>
                </div>
              ))}
            </div>

            {(stage === "precleaning" || stage === "precleaned" || stage === "reviewing" || stage === "reviewed") && (
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {[
                  { label: "Accepted", value: precleanCounts.acceptedMentions },
                  { label: "Rejected", value: precleanCounts.rejectedRows },
                  { label: "Ready", value: precleanCounts.companiesReady },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className={darkMode ? "border border-slate-800 bg-slate-900 p-3" : "border border-slate-300 bg-slate-100 p-3"}
                  >
                    <p className={`retro-font text-[10px] font-black uppercase tracking-[0.14em] ${mutedText}`}>
                      {stat.label}
                    </p>
                    <p className="mt-1 text-2xl font-black">{stat.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>




      </div>
    </main>
  );
}
