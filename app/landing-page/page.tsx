"use client";

import Link from "next/link";
import { useState } from "react";

const steps = [
  {
    number: "01",
    title: "Collect public signals",
    body: "LeadGrid scans noisy public activity like hiring posts, event pages, startup listings, and market mentions to find companies showing movement.",
  },
  {
    number: "02",
    title: "Clean obvious noise",
    body: "The intake layer removes duplicate rows, navigation text, event labels, and obvious garbage before company review.",
  },
  {
    number: "03",
    title: "Review company intent",
    body: "Companies are reviewed for ICP fit, buyer need, urgency, evidence quality, sales motion, confidence, and next best action.",
  },
  {
    number: "04",
    title: "Build a sales queue",
    body: "Only reviewed companies appear in the dashboard, grouped into High Intent, Qualified, Monitor, Needs Review, and Excluded.",
  },
];

const features = [
  "Public signal discovery",
  "Company-level deduplication",
  "Intent scoring",
  "Confidence reasoning",
  "Next-best-action queue",
  "Batch review workflow",
];

const workflow = [
  "Source agents collect raw mentions",
  "Intake filter removes obvious junk",
  "Company merger creates unique accounts",
  "Intent engine reviews companies in batches",
  "Lead Queue reveals reviewed leads only",
  "Sales team acts on ranked opportunities",
];

const workflowDescriptions = [
  "Raw public activity enters the system from jobs, events, startup pages and visible market signals.",
  "Navigation labels, duplicate rows and useless mentions are removed before company review.",
  "Mentions are grouped into one account-level view so the system ranks companies instead of scattered rows.",
  "Each company is reviewed for fit, buying intent, confidence, urgency and buyer need.",
  "Only reviewed accounts become visible, keeping the dashboard clean and trusted.",
  "The sales team acts on ranked opportunities with evidence and next-best actions.",
];

export default function LandingPage() {
  const [darkMode, setDarkMode] = useState(false);

  const pageClass = darkMode
    ? "relative min-h-screen overflow-hidden bg-[#070816] text-white"
    : "relative min-h-screen overflow-hidden bg-[#fff0bd] text-slate-950";

  const navClass = darkMode
    ? "fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-5xl -translate-x-1/2 rounded-full border border-white/10 bg-slate-950/78 px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur-xl md:top-5 md:w-[82%]"
    : "fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-5xl -translate-x-1/2 rounded-full border border-slate-950/10 bg-[#fff7dc]/82 px-4 py-3 shadow-2xl shadow-amber-950/10 backdrop-blur-xl md:top-5 md:w-[82%]";

  const mutedText = darkMode ? "text-slate-300" : "text-slate-700";
  const softText = darkMode ? "text-slate-400" : "text-slate-600";

  return (
    <main className={pageClass}>
      <style>{`
        @keyframes floatPixel {
          0%, 100% { transform: translateY(0); opacity: 0.65; }
          50% { transform: translateY(-18px); opacity: 1; }
        }

        @keyframes scan {
          0% { transform: translateY(-100%); opacity: 0; }
          25% { opacity: 0.24; }
          100% { transform: translateY(100%); opacity: 0; }
        }

        @keyframes blink {
          0%, 48% { opacity: 1; }
          49%, 100% { opacity: 0; }
        }

        @keyframes glow {
          0%, 100% { box-shadow: 0 0 0 rgba(139, 92, 246, 0); }
          50% { box-shadow: 0 0 64px rgba(139, 92, 246, 0.55); }
        }

        @keyframes snakeDash {
          from { stroke-dashoffset: 36; }
          to { stroke-dashoffset: 0; }
        }

        @keyframes packetMove {
          0% { offset-distance: 0%; opacity: 0; }
          5% { opacity: 1; }
          95% { opacity: 1; }
          100% { offset-distance: 100%; opacity: 0; }
        }

        .retro-font {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        }

        .retro-title {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          letter-spacing: -0.11em;
          text-shadow:
            6px 0 0 rgba(139, 92, 246, 0.58),
            -6px 0 0 rgba(34, 211, 238, 0.38),
            0 8px 0 rgba(15, 23, 42, 0.24);
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

        .float-pixel {
          animation: floatPixel 4.5s ease-in-out infinite;
        }

        .scan-screen::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.18), transparent);
          animation: scan 5.8s linear infinite;
          pointer-events: none;
        }

        .blink {
          animation: blink 1s step-end infinite;
        }

        .glow-core {
          animation: glow 2.5s ease-in-out infinite;
        }

        .snake-dash {
          stroke-dasharray: 12 14;
          animation: snakeDash 1.3s linear infinite;
        }

        .snake-packet {
          offset-path: path("M 140 120 H 520 H 900 Q 1040 120 1040 260 V 360 Q 1040 500 900 500 H 520 H 140");
          animation: packetMove 8s linear infinite;
        }

        .snake-packet-two {
          offset-path: path("M 140 120 H 520 H 900 Q 1040 120 1040 260 V 360 Q 1040 500 900 500 H 520 H 140");
          animation: packetMove 8s linear infinite;
          animation-delay: 2.7s;
        }

        .snake-packet-three {
          offset-path: path("M 140 120 H 520 H 900 Q 1040 120 1040 260 V 360 Q 1040 500 900 500 H 520 H 140");
          animation: packetMove 8s linear infinite;
          animation-delay: 5.4s;
        }
      `}</style>

      <div className="pointer-events-none fixed inset-0 z-[1]">
        <div
          className={darkMode ? "absolute inset-0 opacity-[0.14] [background-image:linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] [background-size:34px_34px]" : "absolute inset-0 opacity-[0.26] [background-image:linear-gradient(to_right,#111827_1px,transparent_1px),linear-gradient(to_bottom,#111827_1px,transparent_1px)] [background-size:34px_34px]"}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute left-1/2 top-[8%] h-[900px] w-[900px] -translate-x-1/2 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="absolute right-[-140px] top-[2%] h-[540px] w-[540px] rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute bottom-[22%] left-[-140px] h-[540px] w-[540px] rounded-full bg-emerald-400/18 blur-3xl" />
        <div className="absolute bottom-[-180px] right-[-120px] h-[560px] w-[560px] rounded-full bg-violet-500/14 blur-3xl" />
      </div>

      <nav className={navClass}>
        <div className="mx-auto flex items-center justify-between gap-4">
          <Link href="/landing-page" className="flex items-center gap-3">
            <span className="grid h-11 w-11 grid-cols-2 gap-0.5 overflow-hidden rounded-xl border-2 border-slate-950 bg-slate-950 p-1 shadow-[4px_4px_0_rgba(139,92,246,0.55)]">
              <span className="bg-violet-400" />
              <span className="bg-cyan-300" />
              <span className="bg-emerald-300" />
              <span className="bg-amber-300" />
            </span>
            <span>
              <span className="retro-font block text-xl font-black uppercase leading-none tracking-[-0.08em]">
                LeadGrid
              </span>
              <span className={darkMode ? "block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500" : "block text-[10px] font-black uppercase tracking-[0.18em] text-slate-600"}>
                Signal Console
              </span>
            </span>
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            <a href="#about" className={darkMode ? "retro-font text-xs font-black uppercase tracking-[0.16em] text-slate-300 hover:text-cyan-300" : "retro-font text-xs font-black uppercase tracking-[0.16em] text-slate-700 hover:text-violet-700"}>
              About
            </a>
            <a href="#how" className={darkMode ? "retro-font text-xs font-black uppercase tracking-[0.16em] text-slate-300 hover:text-cyan-300" : "retro-font text-xs font-black uppercase tracking-[0.16em] text-slate-700 hover:text-violet-700"}>
              How it works
            </a>
            <a href="#workflow" className={darkMode ? "retro-font text-xs font-black uppercase tracking-[0.16em] text-slate-300 hover:text-cyan-300" : "retro-font text-xs font-black uppercase tracking-[0.16em] text-slate-700 hover:text-violet-700"}>
              Workflow
            </a>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setDarkMode(!darkMode)}
              aria-label="Toggle color mode"
              className={darkMode ? "grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-slate-900 text-lg shadow-sm transition hover:-translate-y-0.5" : "grid h-10 w-10 place-items-center rounded-full border border-slate-950/10 bg-white/80 text-lg shadow-sm transition hover:-translate-y-0.5"}
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              {darkMode ? "☀" : "☾"}
            </button>

            <Link
              href="/console"
              className="rounded-full bg-slate-950 px-5 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-white shadow-[4px_4px_0_rgba(139,92,246,0.6)] transition hover:-translate-y-0.5"
            >
              Open App
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative z-20 min-h-screen w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-0 z-10">
          <span className="float-pixel absolute left-[5%] top-[18%] h-5 w-5 bg-violet-400" />
          <span className="float-pixel absolute left-[10%] top-[36%] h-3 w-3 bg-cyan-300 [animation-delay:0.2s]" />
          <span className="float-pixel absolute left-[17%] top-[13%] h-4 w-4 bg-emerald-300 [animation-delay:0.4s]" />
          <span className="float-pixel absolute left-[80%] top-[14%] h-5 w-5 bg-amber-300 [animation-delay:0.6s]" />
          <span className="float-pixel absolute left-[91%] top-[29%] h-3 w-3 bg-violet-400 [animation-delay:0.8s]" />
          <span className="float-pixel absolute left-[84%] top-[75%] h-5 w-5 bg-cyan-300 [animation-delay:1s]" />
          <span className="float-pixel absolute left-[9%] top-[80%] h-4 w-4 bg-amber-300 [animation-delay:1.2s]" />
          <span className="float-pixel absolute left-[35%] top-[88%] h-3 w-3 bg-emerald-300 [animation-delay:1.4s]" />
        </div>

        <div className="relative z-20 grid min-h-screen w-full items-center gap-10 px-5 pb-14 pt-28 md:px-10 lg:grid-cols-[1.05fr_0.95fr] lg:px-16 xl:px-24">
          <div className="max-w-5xl">
            <div className={darkMode ? "retro-box mb-8 inline-flex border-2 border-violet-400/40 bg-violet-400/10 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-violet-200" : "retro-box mb-8 inline-flex border-2 border-violet-500/40 bg-violet-100 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-violet-700"}>
              Lead intelligence for outbound teams
            </div>

            <h1 className="retro-title text-[5rem] font-black uppercase leading-[0.78] sm:text-[7rem] md:text-[9.2rem] xl:text-[12rem]">
              Lead
              <br />
              Grid
            </h1>

            <p className={`mt-8 max-w-3xl text-xl font-semibold leading-8 md:text-2xl md:leading-10 ${mutedText}`}>
              A retro-styled lead intelligence platform that turns public company activity into a
              ranked outbound queue for appointment-setting, SDR teams, and sales operators.
            </p>

            <div className="mt-8 flex flex-wrap gap-2">
              {features.map((feature) => (
                <span
                  key={feature}
                  className={darkMode ? "retro-box border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-300" : "retro-box border border-slate-300 bg-white/75 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-700"}
                >
                  {feature}
                </span>
              ))}
            </div>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/console"
                className="retro-box bg-slate-950 px-8 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-white shadow-[8px_8px_0_rgba(139,92,246,0.65)] transition hover:-translate-y-1 hover:shadow-[12px_12px_0_rgba(139,92,246,0.65)]"
              >
                Open App
              </Link>

              <a
                href="#how"
                className={darkMode ? "retro-box border-2 border-slate-700 bg-slate-900 px-8 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-slate-100 transition hover:-translate-y-1 hover:border-cyan-300" : "retro-box border-2 border-slate-950 bg-white px-8 py-4 text-center text-sm font-black uppercase tracking-[0.16em] text-slate-950 transition hover:-translate-y-1 hover:border-violet-500"}
              >
                See the System
              </a>
            </div>
          </div>

          <div className={darkMode ? "retro-box scan-screen relative overflow-hidden border-2 border-slate-700 bg-slate-950/88 p-5 shadow-[14px_14px_0_rgba(139,92,246,0.28)]" : "retro-box scan-screen relative overflow-hidden border-2 border-slate-950 bg-white/88 p-5 shadow-[14px_14px_0_rgba(139,92,246,0.28)]"}>
            <div className="relative z-10">
              <div className={darkMode ? "mb-5 flex items-center justify-between border-b border-slate-700 pb-4" : "mb-5 flex items-center justify-between border-b border-slate-300 pb-4"}>
                <div>
                  <p className="retro-font text-xs font-black uppercase tracking-[0.2em] text-cyan-500">
                    Product Console
                  </p>
                  <p className="mt-1 text-3xl font-black">Signal Engine</p>
                </div>

                <div className="flex gap-1">
                  <span className="h-3 w-3 bg-emerald-300" />
                  <span className="h-3 w-3 bg-amber-300" />
                  <span className="h-3 w-3 bg-violet-400" />
                </div>
              </div>

              <div className="space-y-3 font-mono text-sm">
                {[
                  ["text-emerald-500", "collect public company signals"],
                  ["text-cyan-500", "merge mentions into unique companies"],
                  ["text-violet-500", "score intent, fit and confidence"],
                  ["text-amber-500", "reveal reviewed leads in batches"],
                ].map(([color, copy], index) => (
                  <div key={copy} className={darkMode ? "bg-slate-900 p-4 text-slate-300" : "bg-slate-100 p-4 text-slate-700"}>
                    <span className={color}>&gt;</span> {copy}
                    {index === 0 && <span className="blink">_</span>}
                  </div>
                ))}
              </div>

              <div className="relative mx-auto mt-8 aspect-square max-w-[420px]">
                <div className="absolute inset-0 border-2 border-violet-400/30" />
                <div className="absolute inset-[12%] border-2 border-cyan-300/40" />
                <div className="absolute inset-[24%] border-2 border-emerald-300/40" />

                <div className="glow-core absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 bg-violet-500" />

                <span className="absolute left-[20%] top-[25%] h-5 w-5 bg-emerald-300 shadow-[0_0_24px_rgba(52,211,153,0.9)]" />
                <span className="absolute left-[72%] top-[28%] h-4 w-4 bg-cyan-300 shadow-[0_0_24px_rgba(34,211,238,0.9)]" />
                <span className="absolute left-[76%] top-[67%] h-6 w-6 bg-violet-400 shadow-[0_0_24px_rgba(167,139,250,0.9)]" />
                <span className="absolute left-[26%] top-[74%] h-4 w-4 bg-amber-300 shadow-[0_0_24px_rgba(252,211,77,0.9)]" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="about" className="relative z-20 overflow-hidden bg-slate-950 px-5 py-24 text-white md:px-10 lg:px-20">
        <div className="pointer-events-none absolute inset-0 z-0">
          <div className="absolute inset-0 opacity-[0.10] [background-image:linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] [background-size:34px_34px]" />
        </div>
        <div className="relative z-20 mx-auto max-w-7xl">
          <p className="retro-font text-sm font-black uppercase tracking-[0.24em] text-violet-300">
            About the product
          </p>

          <div className="mt-6 grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <h2 className="text-5xl font-black tracking-tight md:text-7xl">
              Built for finding the right companies before outreach begins.
            </h2>

            <div className="space-y-6 text-lg leading-8 text-slate-300">
              <p>
                Most outbound lists are static. LeadGrid starts with public intent signals and turns
                those signals into company-level sales decisions.
              </p>
              <p>
                The platform is designed for an appointment-setting or outbound sales team that
                needs to know which companies are worth researching, contacting, or excluding.
              </p>
              <p>
                Instead of showing raw scraped data, the product shows reviewed accounts with
                reasoning, confidence, decision labels, buyer need, and recommended next actions.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className={darkMode ? "relative z-20 overflow-hidden px-5 py-24 text-white md:px-10 lg:px-20" : "relative z-20 overflow-hidden px-5 py-24 text-slate-950 md:px-10 lg:px-20"}>
        <div className="relative z-20 mx-auto max-w-7xl">
          <p className={darkMode ? "retro-font text-sm font-black uppercase tracking-[0.24em] text-violet-300" : "retro-font text-sm font-black uppercase tracking-[0.24em] text-violet-700"}>
            How we are doing this
          </p>

          <h2 className="mt-6 max-w-5xl text-5xl font-black tracking-tight md:text-7xl">
            A signal pipeline that turns noisy public data into a clean lead queue.
          </h2>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {steps.map((step) => (
              <div
                key={step.number}
                className={
                  darkMode
                    ? "retro-box border-2 border-slate-700 bg-slate-950/88 p-6 shadow-[8px_8px_0_rgba(103,232,249,0.14)]"
                    : "retro-box border-2 border-slate-950 bg-white/88 p-6 shadow-[8px_8px_0_rgba(139,92,246,0.22)]"
                }
              >
                <p className="retro-font text-xs font-black text-violet-600">{step.number}</p>
                <h3 className="mt-4 text-2xl font-black uppercase tracking-tight">{step.title}</h3>
                <p className={`mt-4 text-sm leading-6 ${softText}`}>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="relative z-20 overflow-hidden bg-slate-950 px-5 py-24 text-white md:px-10 lg:px-20">
        <div className="pointer-events-none absolute inset-0 z-0">
          <div className="absolute inset-0 opacity-[0.10] [background-image:linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] [background-size:34px_34px]" />
        </div>
        <div className="relative z-20 mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
            <div>
              <p className="retro-font text-sm font-black uppercase tracking-[0.24em] text-cyan-300">
                Workflow
              </p>
              <h2 className="mt-6 text-5xl font-black tracking-tight md:text-7xl">
                From source signals to sales action.
              </h2>
            </div>

            <p className="max-w-3xl text-lg leading-8 text-slate-400">
              The product works like a retro signal circuit. Data enters from public sources,
              moves through cleaning and company review, then exits as a ranked outbound queue.
            </p>
          </div>

          <div className="relative mt-16 hidden min-h-[640px] xl:block">
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 1180 640"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="snakeGlow" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0%" stopColor="#67e8f9" />
                  <stop offset="35%" stopColor="#a78bfa" />
                  <stop offset="70%" stopColor="#fcd34d" />
                  <stop offset="100%" stopColor="#34d399" />
                </linearGradient>
              </defs>

              <path
                d="M 140 120 H 520 H 900 Q 1040 120 1040 260 V 360 Q 1040 500 900 500 H 520 H 140"
                fill="none"
                stroke="#1e293b"
                strokeWidth="18"
                strokeLinecap="square"
                strokeLinejoin="round"
              />

              <path
                d="M 140 120 H 520 H 900 Q 1040 120 1040 260 V 360 Q 1040 500 900 500 H 520 H 140"
                fill="none"
                stroke="url(#snakeGlow)"
                strokeWidth="6"
                strokeLinecap="square"
                strokeLinejoin="round"
                opacity="0.95"
              />

              <path
                className="snake-dash"
                d="M 140 120 H 520 H 900 Q 1040 120 1040 260 V 360 Q 1040 500 900 500 H 520 H 140"
                fill="none"
                stroke="#67e8f9"
                strokeWidth="2"
                strokeLinecap="square"
                strokeLinejoin="round"
                opacity="0.72"
              />
            </svg>

            <div className="snake-packet absolute left-0 top-0 h-5 w-5 bg-cyan-300 shadow-[0_0_28px_rgba(103,232,249,0.95)]" />
            <div className="snake-packet-two absolute left-0 top-0 h-4 w-4 bg-violet-300 shadow-[0_0_28px_rgba(196,181,253,0.95)]" />
            <div className="snake-packet-three absolute left-0 top-0 h-4 w-4 bg-emerald-300 shadow-[0_0_28px_rgba(52,211,153,0.95)]" />

            {workflow.map((item, index) => {
              const positions = [
                "left-[0%] top-[24px]",
                "left-[36.5%] top-[24px]",
                "left-[73%] top-[24px]",
                "left-[73%] top-[404px]",
                "left-[36.5%] top-[404px]",
                "left-[0%] top-[404px]",
              ];

              return (
                <div key={item} className={`absolute ${positions[index]} w-[25.5%]`}>
                  <div className="retro-box group min-h-[216px] border-2 border-slate-800 bg-slate-900/94 p-6 shadow-[8px_8px_0_rgba(103,232,249,0.10)] transition duration-300 hover:-translate-y-2 hover:border-cyan-300 hover:shadow-[14px_14px_0_rgba(103,232,249,0.22)]">
                    <div className="flex items-start justify-between gap-4">
                      <p className="retro-font text-sm font-black text-cyan-500">
                        {(index + 1).toString().padStart(2, "0")}
                      </p>

                      <span className="grid h-9 w-9 place-items-center border-2 border-cyan-300 bg-cyan-300 font-black text-slate-950 transition group-hover:rotate-6">
                        {index === 2 ? "↓" : index > 2 ? "←" : "→"}
                      </span>
                    </div>

                    <h3 className="mt-5 text-2xl font-black tracking-tight">{item}</h3>

                    <p className="mt-4 text-sm leading-6 text-slate-400">
                      {workflowDescriptions[index]}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-12 grid gap-5 xl:hidden">
            {workflow.map((item, index) => (
              <div
                key={item}
                className="retro-box border-2 border-slate-800 bg-slate-900 p-6 shadow-[8px_8px_0_rgba(103,232,249,0.10)]"
              >
                <p className="retro-font text-sm font-black text-cyan-500">
                  {(index + 1).toString().padStart(2, "0")}
                </p>
                <h3 className="mt-4 text-2xl font-black">{item}</h3>
              </div>
            ))}
          </div>

        </div>
      </section>

      <section
        className={
          darkMode
            ? "relative z-20 overflow-hidden bg-slate-950 px-5 py-24 text-white md:px-10 lg:px-20"
            : "relative z-20 overflow-hidden bg-[#fff0bd] px-5 py-24 text-slate-950 md:px-10 lg:px-20"
        }
      >
        <div className="pointer-events-none absolute inset-0 z-0">
          <div
            className={
              darkMode
                ? "absolute inset-0 opacity-[0.10] [background-image:linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] [background-size:34px_34px]"
                : "absolute inset-0 opacity-[0.24] [background-image:linear-gradient(to_right,#111827_1px,transparent_1px),linear-gradient(to_bottom,#111827_1px,transparent_1px)] [background-size:34px_34px]"
            }
          />
          <div className="absolute left-[-120px] top-[-140px] h-[460px] w-[460px] rounded-full bg-violet-500/14 blur-3xl" />
          <div className="absolute bottom-[-140px] right-[-120px] h-[500px] w-[500px] rounded-full bg-cyan-400/16 blur-3xl" />
        </div>

        <div className="relative z-20 mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p
              className={
                darkMode
                  ? "retro-font text-sm font-black uppercase tracking-[0.24em] text-violet-300"
                  : "retro-font text-sm font-black uppercase tracking-[0.24em] text-violet-700"
              }
            >
              Launch the console
            </p>

            <h2 className="mt-5 max-w-4xl text-5xl font-black tracking-tight md:text-7xl">
              Ready to inspect the live queue?
            </h2>

            <p
              className={
                darkMode
                  ? "mt-5 max-w-3xl text-lg leading-8 text-slate-400"
                  : "mt-5 max-w-3xl text-lg leading-8 text-slate-700"
              }
            >
              Open the dashboard to view reviewed companies, scoring, evidence, exclusions,
              and the next 50 lead workflow.
            </p>
          </div>

          <Link
            href="/console"
            className="retro-box bg-slate-950 px-9 py-5 text-center text-sm font-black uppercase tracking-[0.16em] text-white shadow-[10px_10px_0_rgba(139,92,246,0.65)] transition hover:-translate-y-1"
          >
            Open App
          </Link>
        </div>
      </section>
    </main>
  );
}
