import fs from "node:fs";
import dotenv from "dotenv";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

dotenv.config({ path: ".env.local" });

const OUTPUT_JSON = dataPath("real-source-mentions.json");
const OUTPUT_CSV = dataPath("real-source-mentions.csv");

const MAX_REMOTE_OK_JOBS = Number(process.env.MAX_REMOTE_OK_JOBS || 120);
const MAX_ARBEITNOW_JOBS = Number(process.env.MAX_ARBEITNOW_JOBS || 120);
const MAX_REMOTIVE_JOBS = Number(process.env.MAX_REMOTIVE_JOBS || 120);
const MAX_JOBICY_JOBS = Number(process.env.MAX_JOBICY_JOBS || 120);
const MAX_HN_COMMENTS = Number(process.env.MAX_HN_COMMENTS || 200);
const MAX_CONFERENCE_COMPANIES = Number(process.env.MAX_CONFERENCE_COMPANIES || 80);

const targetSearchTerms = [
  "sales",
  "business development",
  "account executive",
  "customer success",
  "growth",
  "marketing",
  "partnerships",
  "revenue",
];

const hiringIntentKeywords = [
  "sales",
  "account executive",
  "business development",
  "sdr",
  "bdr",
  "revenue",
  "revops",
  "growth",
  "marketing",
  "demand generation",
  "customer success",
  "partnerships",
  "commercial",
  "go-to-market",
  "gtm",
  "pipeline",
  "saas",
  "b2b",
];

const conferenceSources = [
  {
    name: "Web Summit Partners",
    url: "https://websummit.com/partners/",
    eventDescription:
      "Public conference partner page. Conference presence is treated as GTM visibility / budget / market activity signal.",
  },
  {
    name: "SaaStr AI Annual",
    url: "https://www.saastrannual2026.com/sponsors",
    eventDescription:
      "B2B SaaS / AI conference page. Presence around this ecosystem is treated as GTM and revenue-market signal.",
  },
];

function stripHtml(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value = "") {
  return String(value)
    .replace(/\u00e2\u0080\u0094/g, "—")
    .replace(/\u00e2\u0080\u0093/g, "–")
    .replace(/\u00e2\u0080\u0099/g, "'")
    .replace(/\u00c2\u00a3/g, "£")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[_-]+logo$/i, "")
    .replace(/\s+logo$/i, "")
    .replace(/^image:\s*/i, "")
    .trim();
}

function hasHiringIntent(text = "") {
  const value = cleanText(text).toLowerCase();
  return hiringIntentKeywords.some((keyword) => value.includes(keyword));
}

function isBadCompanyName(name = "") {
  const value = cleanText(name).toLowerCase();

  if (!value) return true;
  if (value.length < 2) return true;
  if (value.length > 80) return true;

  const bad = new Set([
    "home",
    "login",
    "apply",
    "apply now",
    "book tickets",
    "download overview",
    "see more",
    "support center",
    "privacy",
    "terms",
    "cookie policy",
    "volunteers",
    "careers",
    "blog",
    "media",
    "about us",
    "newsletter",
    "agenda",
    "speakers",
    "schedule",
    "partners",
    "startups",
    "investors",
    "attendees",
    "exhibitors",
    "sponsors",
    "remote",
    "onsite",
    "hybrid",
    "we",
    "i",
    "hiring",
    "looking",
    "engineer",
    "developer",
    "software",
  ]);

  if (bad.has(value)) return true;
  if (/^\d+$/.test(value)) return true;
  if (/^[^a-zA-Z0-9]+$/.test(value)) return true;

  return false;
}

function extractWebsite(rawHtml, text) {
  const hrefMatch = String(rawHtml).match(/href=["'](https?:\/\/[^"']+)["']/i);
  if (hrefMatch?.[1]) return hrefMatch[1];

  const urlMatch = String(text).match(/https?:\/\/[^\s)]+/i);
  if (urlMatch?.[0]) return urlMatch[0];

  return undefined;
}

function extractCompanyNameFromHiringText(text) {
  const cleaned = cleanText(text);

  const strongPatterns = [
    /^([^|]{2,80})\s*\|/,
    /^([A-Z][A-Za-z0-9 .,&'-]{2,80})\s+is hiring/i,
    /^([A-Z][A-Za-z0-9 .,&'-]{2,80})\s+hiring/i,
    /^at\s+([A-Z][A-Za-z0-9 .,&'-]{2,80})/i,
    /we(?:'re| are)\s+hiring\s+at\s+([A-Z][A-Za-z0-9 .,&'-]{2,80})/i,
  ];

  for (const pattern of strongPatterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) {
      const name = cleanText(match[1])
        .split(" - ")[0]
        .split(" — ")[0]
        .split(" – ")[0]
        .split(":")[0]
        .replace(/\s+\(.*?\)$/g, "")
        .trim();

      if (!isBadCompanyName(name)) return name;
    }
  }

  let fallback = cleaned
    .split("|")[0]
    .split(" - ")[0]
    .split(" — ")[0]
    .split(" – ")[0]
    .split(":")[0]
    .trim();

  fallback = fallback
    .replace(/^at\s+/i, "")
    .replace(/\s+is hiring.*$/i, "")
    .replace(/\s+hiring.*$/i, "")
    .replace(/\s+\(.*?\)$/g, "")
    .trim();

  if (!isBadCompanyName(fallback)) return fallback;

  return null;
}

function csvEscape(value) {
  if (value === undefined || value === null) return "";
  const str = Array.isArray(value) ? value.join("; ") : String(value);
  const cleaned = str.replace(/\r?\n|\r/g, " ").replace(/\s+/g, " ").trim();
  return `"${cleaned.replace(/"/g, '""')}"`;
}

function writeCsv(rows, path) {
  const headers = [
    "id",
    "rawName",
    "website",
    "sourceType",
    "sourceName",
    "sourceUrl",
    "description",
    "homepageText",
    "careersText",
    "lastActivityDate",
    "country",
    "estimatedSize",
    "stageHint",
    "agentConfidence",
    "expectedCategory",
    "expectedTrashReason",
  ];

  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");

  fs.writeFileSync(path, csv);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "LeadSignalPOC/1.0",
      "Accept": "application/json,text/plain,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${url}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "LeadSignalPOC/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${url}`);
  }

  return response.text();
}

async function collectHackerNewsWhoIsHiring() {
  console.log("Collecting Hacker News Who is Hiring...");

  const searchUrl =
    "https://hn.algolia.com/api/v1/search_by_date?query=who%20is%20hiring&tags=story&hitsPerPage=20";

  const searchData = await fetchJson(searchUrl);

  const story = searchData.hits.find((hit) =>
    String(hit.title || hit.story_title || "")
      .toLowerCase()
      .includes("who is hiring")
  );

  if (!story) {
    console.log("No Hacker News Who is Hiring story found.");
    return [];
  }

  const storyId = story.objectID;
  const storyUrl = `https://news.ycombinator.com/item?id=${storyId}`;

  const rows = [];

  for (let page = 0; page < 3; page++) {
    const commentsUrl =
      `https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${storyId}&hitsPerPage=100&page=${page}`;

    const commentsData = await fetchJson(commentsUrl);

    for (const comment of commentsData.hits || []) {
      if (rows.length >= MAX_HN_COMMENTS) break;

      const html = comment.comment_text || "";
      const text = stripHtml(html);

      if (!text || text.length < 40) continue;

      const companyName = extractCompanyNameFromHiringText(text);
      if (!companyName) continue;

      rows.push({
        id: `hn_${comment.objectID}`,
        rawName: companyName,
        website: extractWebsite(html, text),
        sourceType: "careers_page",
        sourceName: "Hacker News Who is Hiring",
        sourceUrl: storyUrl,
        description: text.slice(0, 500),
        homepageText: text.slice(0, 900),
        careersText: text.slice(0, 1600),
        lastActivityDate: String(comment.created_at || "").slice(0, 10),
        country: "",
        estimatedSize: "",
        stageHint: "real_public_hiring_signal",
        agentConfidence: 0.75,
        expectedCategory: "real_source_unclassified",
        expectedTrashReason: "",
      });
    }
  }

  console.log(`HN extracted: ${rows.length}`);
  return rows;
}

async function collectRemoteOk() {
  console.log("Collecting Remote OK jobs...");

  const data = await fetchJson("https://remoteok.com/api");

  const jobs = data
    .filter((item) => item && item.company && item.position)
    .filter((job) => {
      const text = `${job.company} ${job.position} ${
        Array.isArray(job.tags) ? job.tags.join(" ") : ""
      } ${stripHtml(job.description || "")}`;

      return hasHiringIntent(text);
    })
    .slice(0, MAX_REMOTE_OK_JOBS);

  const rows = jobs.map((job) => {
    const text = stripHtml(job.description || "");
    const tags = Array.isArray(job.tags) ? job.tags.join(", ") : "";

    return {
      id: `remoteok_${job.id}`,
      rawName: cleanText(job.company),
      website: job.url || job.apply_url || "",
      sourceType: "careers_page",
      sourceName: "Remote OK",
      sourceUrl: job.url || "https://remoteok.com/api",
      description: `${job.position}. Tags: ${tags}`.slice(0, 500),
      homepageText: `${job.company} is hiring for ${job.position}. Tags: ${tags}`.slice(0, 900),
      careersText: `${job.position}. ${text}`.slice(0, 1600),
      lastActivityDate: String(job.date || "").slice(0, 10),
      country: job.location || "",
      estimatedSize: "",
      stageHint: "real_public_job_posting",
      agentConfidence: 0.85,
      expectedCategory: "real_source_unclassified",
      expectedTrashReason: "",
    };
  });

  console.log(`Remote OK extracted: ${rows.length}`);
  return rows;
}

async function collectArbeitnow() {
  console.log("Collecting Arbeitnow jobs...");

  const rows = [];

  for (const term of targetSearchTerms) {
    try {
      const url = `https://www.arbeitnow.com/api/job-board-api?search=${encodeURIComponent(
        term
      )}&page=1`;

      const data = await fetchJson(url);
      const jobs = Array.isArray(data.data) ? data.data : [];

      for (const job of jobs) {
        if (rows.length >= MAX_ARBEITNOW_JOBS) break;

        const text = stripHtml(job.description || "");
        const tags = Array.isArray(job.tags) ? job.tags.join(", ") : "";

        const companyName = cleanText(job.company_name || job.company || "");
        if (!companyName || isBadCompanyName(companyName)) continue;

        rows.push({
          id: `arbeitnow_${job.slug || job.id || `${companyName}_${term}`}`,
          rawName: companyName,
          website: job.url || "",
          sourceType: "careers_page",
          sourceName: "Arbeitnow",
          sourceUrl: job.url || url,
          description: `${job.title || term}. Tags: ${tags}`.slice(0, 500),
          homepageText: `${companyName} is hiring for ${job.title || term}. Tags: ${tags}`.slice(0, 900),
          careersText: `${job.title || term}. ${text}`.slice(0, 1600),
          lastActivityDate: job.created_at
            ? new Date(Number(job.created_at) * 1000).toISOString().slice(0, 10)
            : "",
          country: job.location || "",
          estimatedSize: "",
          stageHint: "real_public_job_posting",
          agentConfidence: 0.8,
          expectedCategory: "real_source_unclassified",
          expectedTrashReason: "",
        });
      }
    } catch (error) {
      console.log(`Arbeitnow search "${term}" failed: ${error.message}`);
    }
  }

  console.log(`Arbeitnow extracted: ${rows.length}`);
  return rows;
}

async function collectRemotive() {
  console.log("Collecting Remotive jobs...");

  const rows = [];

  for (const term of targetSearchTerms) {
    try {
      const url = `https://remotive.com/api/remote-jobs?limit=100&search=${encodeURIComponent(
        term
      )}`;

      const data = await fetchJson(url);
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];

      for (const job of jobs) {
        if (rows.length >= MAX_REMOTIVE_JOBS) break;

        const text = stripHtml(job.description || "");
        const companyName = cleanText(job.company_name || "");
        if (!companyName || isBadCompanyName(companyName)) continue;

        rows.push({
          id: `remotive_${job.id}`,
          rawName: companyName,
          website: job.url || "",
          sourceType: "careers_page",
          sourceName: "Remotive",
          sourceUrl: job.url || url,
          description: `${job.title || term}. Category: ${job.category || ""}`.slice(0, 500),
          homepageText: `${companyName} is hiring for ${job.title || term}. Category: ${job.category || ""}`.slice(0, 900),
          careersText: `${job.title || term}. ${text}`.slice(0, 1600),
          lastActivityDate: String(job.publication_date || "").slice(0, 10),
          country: job.candidate_required_location || "",
          estimatedSize: "",
          stageHint: "real_public_job_posting",
          agentConfidence: 0.82,
          expectedCategory: "real_source_unclassified",
          expectedTrashReason: "",
        });
      }
    } catch (error) {
      console.log(`Remotive search "${term}" failed: ${error.message}`);
    }
  }

  console.log(`Remotive extracted: ${rows.length}`);
  return rows;
}

async function collectJobicy() {
  console.log("Collecting Jobicy jobs...");

  const rows = [];

  for (const term of targetSearchTerms) {
    try {
      const url = `https://jobicy.com/api/v2/remote-jobs?count=100&tag=${encodeURIComponent(
        term
      )}`;

      const data = await fetchJson(url);
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];

      for (const job of jobs) {
        if (rows.length >= MAX_JOBICY_JOBS) break;

        const text = stripHtml(job.jobDescription || "");
        const companyName = cleanText(job.companyName || "");
        if (!companyName || isBadCompanyName(companyName)) continue;

        rows.push({
          id: `jobicy_${job.id}`,
          rawName: companyName,
          website: job.url || "",
          sourceType: "careers_page",
          sourceName: "Jobicy",
          sourceUrl: job.url || url,
          description: `${job.jobTitle || term}. Industry: ${job.jobIndustry || ""}`.slice(0, 500),
          homepageText: `${companyName} is hiring for ${job.jobTitle || term}. Industry: ${job.jobIndustry || ""}`.slice(0, 900),
          careersText: `${job.jobTitle || term}. ${job.jobExcerpt || ""}. ${text}`.slice(0, 1600),
          lastActivityDate: String(job.pubDate || "").slice(0, 10),
          country: job.jobGeo || "",
          estimatedSize: "",
          stageHint: "real_public_job_posting",
          agentConfidence: 0.82,
          expectedCategory: "real_source_unclassified",
          expectedTrashReason: "",
        });
      }
    } catch (error) {
      console.log(`Jobicy search "${term}" failed: ${error.message}`);
    }
  }

  console.log(`Jobicy extracted: ${rows.length}`);
  return rows;
}

function extractConferenceNamesFromHtml(html) {
  const names = new Set();

  const altMatches = [...html.matchAll(/alt=["']([^"']+)["']/gi)];
  for (const match of altMatches) {
    const name = cleanText(match[1]);
    if (!isBadCompanyName(name)) names.add(name);
  }

  const titleMatches = [...html.matchAll(/title=["']([^"']+)["']/gi)];
  for (const match of titleMatches) {
    const name = cleanText(match[1]);
    if (!isBadCompanyName(name)) names.add(name);
  }

  const ariaMatches = [...html.matchAll(/aria-label=["']([^"']+)["']/gi)];
  for (const match of ariaMatches) {
    const name = cleanText(match[1]);
    if (!isBadCompanyName(name)) names.add(name);
  }

  const anchorMatches = [
    ...html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi),
  ];

  for (const match of anchorMatches) {
    const text = cleanText(stripHtml(match[2]));
    if (!isBadCompanyName(text)) names.add(text);
  }

  return [...names].slice(0, MAX_CONFERENCE_COMPANIES);
}

async function collectConferencePages() {
  console.log("Collecting conference partner/exhibitor pages...");

  const rows = [];

  for (const source of conferenceSources) {
    try {
      const html = await fetchText(source.url);
      const names = extractConferenceNamesFromHtml(html);

      for (const name of names) {
        rows.push({
          id: `conference_${source.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")}`,
          rawName: name,
          website: "",
          sourceType: "conference",
          sourceName: source.name,
          sourceUrl: source.url,
          description: source.eventDescription,
          homepageText:
            `${name} appeared on ${source.name}. Conference presence is a GTM visibility and budget signal, not standalone buying intent.`,
          careersText: "",
          lastActivityDate: new Date().toISOString().slice(0, 10),
          country: "",
          estimatedSize: "",
          stageHint: "conference_gtm_visibility_signal",
          agentConfidence: 0.55,
          expectedCategory: "real_source_unclassified",
          expectedTrashReason: "",
        });
      }

      console.log(`${source.name} extracted: ${names.length}`);
    } catch (error) {
      console.log(`${source.name} failed: ${error.message}`);
    }
  }

  return rows;
}

function dedupeRows(rows) {
  const seen = new Set();
  const unique = [];

  for (const row of rows) {
    const companyKey = cleanText(row.rawName).toLowerCase();
    const sourceKey = cleanText(row.sourceName).toLowerCase();
    const urlKey = cleanText(row.sourceUrl).toLowerCase();
    const key = `${companyKey}|${sourceKey}|${urlKey}`;

    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(row);
  }

  return unique;
}

async function main() {
  fs.mkdirSync("data", { recursive: true });

  const hnRows = await collectHackerNewsWhoIsHiring();
  const remoteOkRows = await collectRemoteOk();
  const arbeitnowRows = await collectArbeitnow();
  const remotiveRows = await collectRemotive();
  const jobicyRows = await collectJobicy();
  const conferenceRows = await collectConferencePages();

  const rows = dedupeRows([
    ...hnRows,
    ...remoteOkRows,
    ...arbeitnowRows,
    ...remotiveRows,
    ...jobicyRows,
    ...conferenceRows,
  ]);

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(rows, null, 2));
  writeCsv(rows, OUTPUT_CSV);

  console.log("");
  console.log("Done.");
  console.log(`Total extracted: ${rows.length}`);
  console.log(`Wrote ${OUTPUT_JSON}`);
  console.log(`Wrote ${OUTPUT_CSV}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
