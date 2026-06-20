import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "./data-dir.mjs";

async function writeManagedFile(name, content) {
  const filePath = dataPath(name);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  console.log(`Reset ${filePath}`);
}

const jsonArrayFiles = [
  "current-live-run.json",
  "raw-company-mentions.json",
  "real-source-mentions.json",
  "real-source-mentions-preclean.json",
  "real-source-mentions-rejected-preclean.json",
  "ai-enriched-company-leads.json",
  "company-dashboard-leads.json",
  "saas-conference-source-pages.json",
  "open-lead-rss-sources.json",
];

const csvFiles = [
  "real-source-mentions.csv",
  "real-source-mentions-preclean.csv",
  "real-source-mentions-rejected-preclean.csv",
  "ai-enriched-company-leads.csv",
  "company-dashboard-leads.csv",
];

for (const name of jsonArrayFiles) {
  await writeManagedFile(name, "[]\n");
}

for (const name of csvFiles) {
  await writeManagedFile(name, "");
}

await writeManagedFile(
  "leadgrid-visible-state.json",
  JSON.stringify({ currentPage: 0, maxUnlockedPage: 0, pageSize: 50 }, null, 2)
);

console.log("Full runtime reset complete");
