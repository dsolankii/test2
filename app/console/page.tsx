"use client";

import Link from "next/link";
import { useState } from "react";

type StepResult = {
  ok?: boolean;
  rawMentions?: number;
  uniqueCompanies?: number;
  acceptedMentions?: number;
  rejectedRows?: number;
  companiesReady?: number;
  error?: string;
  logs?: string;
};

export default function ConsolePage() {
  const [running, setRunning] = useState<"scan" | "preclean" | null>(null);
  const [scanResult, setScanResult] = useState<StepResult | null>(null);
  const [precleanResult, setPrecleanResult] = useState<StepResult | null>(null);
  const [message, setMessage] = useState("");

  async function postStep(
    key: "scan" | "preclean",
    endpoint: "/api/run-signal-scan" | "/api/run-preclean"
  ) {
    setRunning(key);
    setMessage(
      key === "scan"
        ? "Running fresh raw extraction. Old runtime files are cleared first..."
        : "Running fresh pre-clean. Old reviewed/dashboard files are cleared first..."
    );

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `${key} failed`);
      }

      if (key === "scan") {
        setScanResult(data);
        setPrecleanResult(null);
        setMessage("Fresh scan complete. Now run pre-clean.");
      } else {
        setPrecleanResult(data);
        setMessage("Pre-clean complete. Open Leads and click Next 50 for Gemini review.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pipeline step failed");
    } finally {
      setRunning(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#070812] px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">
            LeadGrid Console
          </p>
          <h1 className="mt-3 text-4xl font-semibold">
            Fresh lead pipeline
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-300">
            This console only runs fresh raw extraction and light pre-clean.
            Lead scoring and qualification happen only through Gemini review on the Leads page.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <h2 className="text-xl font-semibold">1. Fresh scan</h2>
            <p className="mt-2 text-sm text-slate-300">
              Clears old runtime files, then extracts fresh raw companies from real sources.
            </p>
            <button
              onClick={() => postStep("scan", "/api/run-signal-scan")}
              disabled={running !== null}
              className="mt-5 rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running === "scan" ? "Scanning..." : "Run Fresh Scan"}
            </button>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <h2 className="text-xl font-semibold">2. Pre-clean</h2>
            <p className="mt-2 text-sm text-slate-300">
              Keeps real extracted rows, removes only obvious junk, and clears old reviewed leads.
            </p>
            <button
              onClick={() => postStep("preclean", "/api/run-preclean")}
              disabled={running !== null}
              className="mt-5 rounded-full bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running === "preclean" ? "Pre-cleaning..." : "Run Pre-clean"}
            </button>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <h2 className="text-xl font-semibold">3. Gemini review</h2>
            <p className="mt-2 text-sm text-slate-300">
              Open the Leads page and click Next 50. Only Gemini-reviewed rows appear there.
            </p>
            <Link
              href="/leads"
              className="mt-5 inline-flex rounded-full bg-fuchsia-400 px-5 py-3 text-sm font-semibold text-slate-950"
            >
              Open Leads
            </Link>
          </section>
        </div>

        {message ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-200">
            {message}
          </div>
        ) : null}

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <h3 className="text-lg font-semibold">Fresh scan result</h3>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Stat label="Raw rows" value={scanResult?.rawMentions} />
              <Stat label="Companies" value={scanResult?.uniqueCompanies} />
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <h3 className="text-lg font-semibold">Pre-clean result</h3>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Stat label="Raw rows" value={precleanResult?.rawMentions} />
              <Stat label="Accepted" value={precleanResult?.acceptedMentions} />
              <Stat label="Rejected" value={precleanResult?.rejectedRows} />
              <Stat label="Ready companies" value={precleanResult?.companiesReady} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">
        {typeof value === "number" ? value.toLocaleString() : "—"}
      </div>
    </div>
  );
}
