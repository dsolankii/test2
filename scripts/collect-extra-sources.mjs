import fs from "node:fs";
import dotenv from "dotenv";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

dotenv.config({ path: ".env.local" });

const INPUT_JSON = dataPath("real-source-mentions.json");
const OUTPUT_JSON = dataPath("real-source-mentions.json");
const OUTPUT_CSV = dataPath("real-source-mentions.csv");

const MAX_PRODUCT_HUNT_PRODUCTS = Number(process.env.MAX_PRODUCT_HUNT_PRODUCTS || 120);
const MAX_YC_COMPANIES = Number(process.env.MAX_YC_COMPANIES || 120);
const MAX_EXTRA_CONFERENCE_COMPANIES = Number(process.env.MAX_EXTRA_CONFERENCE_COMPANIES || 160);
const MAX_ADZUNA_JOBS = Number(process.env.MAX_ADZUNA_JOBS || 160);

const targetSearchTerms = [
  "sales",
  "business development",
  "account executive",
  "customer success",
  "growth",
  "marketing",
  "partnerships",
  "revenue",
  "lead generation",
  "demand generation",
];

const broadConferenceSources = [
  {
    name: "MWC Barcelona Exhibitors",
    url: "https://www.mwcbarcelona.com/exhibitors",
    eventDescription:
      "Mobile, telecom, device, cloud, infrastructure, and technology exhibitor source. Useful as broad GTM visibility signal.",
  },
  {
    name: "Web Summit Partners",
    url: "https://websummit.com/partners/",
    eventDescription:
      "Broad technology conference partner page. Useful as GTM visibility, sponsorship, and market activity signal.",
  },
  {
    name: "SaaStr AI Annual Sponsors",
    url: "https://www.saastrannual2026.com/sponsors",
    eventDescription:
      "B2B SaaS and AI conference sponsor page. Useful as revenue/GTM ecosystem signal.",
  },
  {
    name: "Shoptalk Sponsors",
    url: "https://www.shoptalk.com/us/sponsors",
    eventDescription:
      "Retail, ecommerce, commerce, and consumer brand technology sponsor page. Useful for non-SaaS potential buyers.",
  },
  {
    name: "Money20/20 Sponsors",
    url: "https://www.money2020.com/sponsors",
    eventDescription:
      "Fintech, banking, payments, and financial services sponsor source. Useful for outbound support prospects with commercial teams.",
  },
  {
    name: "VivaTech Partners",
    url: "https://vivatechnology.com/partners",
    eventDescription:
      "Broad innovation/startup/enterprise technology partner source. Useful for cross-industry GTM signal.",
  },
];

function cleanText(value = "") {
  return String(value)
    .replace(/\u00e2\u0080\u0094/g, "—")
    .replace(/\u00e2\u0080\u0093/g, "–")
    .replace(/\u00e2\u0080\u0099/g, "'")
    .replace(/\u00c2\u00a3/g, "£")
    .replace(/[ØÙ]+/g, "")
    .replace(/[�]/g, "")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function titleFromSlug(slug = "") {
  return String(slug)
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .trim();
}

function isBadCompanyName(name = "") {
  const value = cleanText(name).toLowerCase();

  if (!value) return true;
  if (value.length < 2) return true;
  if (value.length > 90) return true;

  const bad = new Set([
    "home",
    "login",
    "sign in",
    "apply",
    "apply now",
    "book tickets",
    "download",
    "download overview",
    "learn more",
    "see more",
    "support center",
    "privacy",
    "terms",
    "cookie policy",
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
    "pricing",
    "contact",
    "contact us",
    "all rights reserved",
  ]);

  if (bad.has(value)) return true;
  if (/^\d+$/.test(value)) return true;
  if (/^[^a-zA-Z0-9]+$/.test(value)) return true;

  return false;
}

function csvEscape(value) {
  if (value === undefined || value === null) return "";
  const str = Array.isArray(value) ? value.join("; ") : String(value);
  const cleaned = cleanText(str);
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

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "LeadSignalPOC/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${url}`);
  }

  return response.text();
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

function extractNamesFromGenericHtml(html, limit) {
  const names = new Set();

  const altMatches = [...html.matchAll(/alt=["']([^"']+)["']/gi)];
  for (const match of altMatches) {
    const name = cleanText(match[1])
      .replace(/\s+logo$/i, "")
      .replace(/^logo\s+/i, "");
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

  return [...names].slice(0, limit);
}

async function collectYCombinatorPublic() {
  console.log("Collecting YC Company Directory public page...");

  try {
    const url = "https://www.ycombinator.com/companies";
    const html = await fetchText(url);

    const slugs = new Set();
    const matches = [...html.matchAll(/\/companies\/([a-zA-Z0-9-]+)/g)];

    for (const match of matches) {
      const slug = match[1];
      if (!slug || slug.includes("founders")) continue;
      slugs.add(slug);
    }

    const rows = [...slugs].slice(0, MAX_YC_COMPANIES).map((slug) => {
      const name = titleFromSlug(slug);

      return {
        id: `yc_${slug}`,
        rawName: name,
        website: "",
        sourceType: "accelerator",
        sourceName: "Y Combinator Company Directory",
        sourceUrl: `https://www.ycombinator.com/companies/${slug}`,
        description:
          "Company discovered from YC public company directory. Accelerator/startup presence is an ICP discovery signal, not standalone buying intent.",
        homepageText:
          `${name} appears in the YC company directory. This indicates startup/accelerator context and possible early-stage growth motion.`,
        careersText: "",
        lastActivityDate: new Date().toISOString().slice(0, 10),
        country: "",
        estimatedSize: "",
        stageHint: "accelerator_startup_directory_signal",
        agentConfidence: 0.65,
        expectedCategory: "real_source_unclassified",
        expectedTrashReason: "",
      };
    });

    console.log(`YC extracted: ${rows.length}`);
    return rows;
  } catch (error) {
    console.log(`YC failed: ${error.message}`);
    return [];
  }
}

async function collectProductHuntPublic() {
  console.log("Collecting Product Hunt public products page...");

  try {
    const url = "https://www.producthunt.com/products";
    const html = await fetchText(url);

    const rows = [];
    const seen = new Set();

    const matches = [
      ...html.matchAll(/<a[^>]*href=["']\/products\/([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi),
    ];

    for (const match of matches) {
      if (rows.length >= MAX_PRODUCT_HUNT_PRODUCTS) break;

      const slug = cleanText(match[1]).split("?")[0].split("#")[0];
      if (!slug || seen.has(slug)) continue;

      const anchorText = cleanText(stripHtml(match[2]));
      const name = titleFromSlug(slug);

      if (isBadCompanyName(name)) continue;

      seen.add(slug);

      rows.push({
        id: `producthunt_${slug}`,
        rawName: name,
        website: "",
        sourceType: "startup_directory",
        sourceName: "Product Hunt Products",
        sourceUrl: `https://www.producthunt.com/products/${slug}`,
        description:
          anchorText ||
          "Product discovered from Product Hunt public products page. Product launch/discovery presence is a GTM signal.",
        homepageText:
          `${name} appears on Product Hunt public products discovery. Launch/product presence can indicate GTM activity and early customer acquisition motion.`,
        careersText: "",
        lastActivityDate: new Date().toISOString().slice(0, 10),
        country: "",
        estimatedSize: "",
        stageHint: "product_launch_gtm_signal",
        agentConfidence: 0.62,
        expectedCategory: "real_source_unclassified",
        expectedTrashReason: "",
      });
    }

    console.log(`Product Hunt extracted: ${rows.length}`);
    return rows;
  } catch (error) {
    console.log(`Product Hunt failed: ${error.message}`);
    return [];
  }
}

async function collectExtraConferencePages() {
  console.log("Collecting broader conference/exhibitor pages...");

  const rows = [];

  for (const source of broadConferenceSources) {
    try {
      const html = await fetchText(source.url);
      const names = extractNamesFromGenericHtml(html, MAX_EXTRA_CONFERENCE_COMPANIES);

      for (const name of names) {
        rows.push({
          id: `conference_extra_${source.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")}`,
          rawName: name,
          website: "",
          sourceType: "conference",
          sourceName: source.name,
          sourceUrl: source.url,
          description: source.eventDescription,
          homepageText:
            `${name} appeared on ${source.name}. Conference/sponsor/exhibitor presence is treated as GTM visibility and market activity signal.`,
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

async function collectAdzunaOptional() {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  if (!appId || !appKey) {
    console.log("Skipping Adzuna. Set ADZUNA_APP_ID and ADZUNA_APP_KEY to enable it.");
    return [];
  }

  console.log("Collecting Adzuna jobs...");

  const countries = ["us", "gb", "ca", "au", "in"];
  const rows = [];

  for (const country of countries) {
    for (const term of [
      "sales",
      "business development",
      "account executive",
      "customer success",
      "growth marketing",
      "partnerships",
      "revenue operations",
    ]) {
      if (rows.length >= MAX_ADZUNA_JOBS) break;

      try {
        const url =
          `https://api.adzuna.com/v1/api/jobs/${country}/search/1` +
          `?app_id=${encodeURIComponent(appId)}` +
          `&app_key=${encodeURIComponent(appKey)}` +
          `&results_per_page=20` +
          `&what=${encodeURIComponent(term)}` +
          `&content-type=application/json`;

        const data = await fetchJson(url);
        const jobs = Array.isArray(data.results) ? data.results : [];

        for (const job of jobs) {
          if (rows.length >= MAX_ADZUNA_JOBS) break;

          const companyName = cleanText(job.company?.display_name || "");
          if (!companyName || isBadCompanyName(companyName)) continue;

          const location = cleanText(job.location?.display_name || "");

          rows.push({
            id: `adzuna_${country}_${job.id}`,
            rawName: companyName,
            website: job.redirect_url || "",
            sourceType: "careers_page",
            sourceName: "Adzuna Jobs API",
            sourceUrl: job.redirect_url || url,
            description: `${job.title || term}. Category: ${job.category?.label || ""}`,
            homepageText:
              `${companyName} is hiring for ${job.title || term}. Job source: Adzuna. Category: ${job.category?.label || ""}`,
            careersText: `${job.title || term}. ${job.description || ""}`.slice(0, 1600),
            lastActivityDate: String(job.created || "").slice(0, 10),
            country: location || country,
            estimatedSize: "",
            stageHint: "free_key_job_api_signal",
            agentConfidence: 0.82,
            expectedCategory: "real_source_unclassified",
            expectedTrashReason: "",
          });
        }
      } catch (error) {
        console.log(`Adzuna ${country}/${term} failed: ${error.message}`);
      }
    }
  }

  console.log(`Adzuna extracted: ${rows.length}`);
  return rows;
}

function dedupeRows(rows) {
  const seen = new Set();
  const unique = [];

  for (const row of rows) {
    const companyKey = cleanText(row.rawName).toLowerCase();
    const sourceKey = cleanText(row.sourceName).toLowerCase();
    const urlKey = cleanText(row.sourceUrl || row.website || "").toLowerCase();
    const key = `${companyKey}|${sourceKey}|${urlKey}`;

    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  return unique;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const existingRows = fs.existsSync(INPUT_JSON)
    ? JSON.parse(fs.readFileSync(INPUT_JSON, "utf-8"))
    : [];

  console.log(`Existing rows: ${existingRows.length}`);

  const ycRows = await collectYCombinatorPublic();
  const productHuntRows = await collectProductHuntPublic();
  const conferenceRows = await collectExtraConferencePages();
  const adzunaRows = await collectAdzunaOptional();

  const finalRows = dedupeRows([
    ...existingRows,
    ...ycRows,
    ...productHuntRows,
    ...conferenceRows,
    ...adzunaRows,
  ]);

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(finalRows, null, 2));
  writeCsv(finalRows, OUTPUT_CSV);

  const bySource = finalRows.reduce((acc, row) => {
    acc[row.sourceName] = (acc[row.sourceName] || 0) + 1;
    return acc;
  }, {});

  console.log("");
  console.log("Extra source collection done.");
  console.log(`Final total rows: ${finalRows.length}`);
  console.log("");
  console.table(bySource);
  console.log("");
  console.log(`Wrote ${OUTPUT_JSON}`);
  console.log(`Wrote ${OUTPUT_CSV}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
