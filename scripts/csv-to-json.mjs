import fs from "node:fs";
import Papa from "papaparse";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

const inputPath = dataPath("raw-company-mentions.csv");
const outputPath = dataPath("raw-company-mentions.json");

if (!fs.existsSync(inputPath)) {
  console.error(`Missing CSV file at ${inputPath}`);
  console.error("Put your downloaded CSV there and run this script again.");
  process.exit(1);
}

const allowedSourceTypes = new Set([
  "conference",
  "accelerator",
  "startup_directory",
  "careers_page",
  "funding_news",
]);

const csv = fs.readFileSync(inputPath, "utf-8");

const parsed = Papa.parse(csv, {
  header: true,
  skipEmptyLines: true,
});

if (parsed.errors.length) {
  console.error("CSV parse errors:", parsed.errors);
  process.exit(1);
}

const rows = parsed.data.map((row, index) => {
  const sourceType = allowedSourceTypes.has(row.sourceType)
    ? row.sourceType
    : "startup_directory";

  return {
    id: row.id || `raw_${index + 1}`,
    rawName: row.rawName || "Unknown Company",
    website: row.website || undefined,
    sourceType,
    sourceName: row.sourceName || undefined,
    sourceUrl: row.sourceUrl || "unknown",
    description: row.description || "",
    homepageText: row.homepageText || "",
    careersText: row.careersText || "",
    lastActivityDate: row.lastActivityDate || undefined,

    country: row.country || undefined,
    estimatedSize: row.estimatedSize || undefined,
    stageHint: row.stageHint || undefined,
    agentConfidence: row.agentConfidence ? Number(row.agentConfidence) : undefined,
    expectedCategory: row.expectedCategory || undefined,
    expectedTrashReason: row.expectedTrashReason || undefined,
  };
});

fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2));

console.log(`Converted ${rows.length} CSV rows`);
console.log(`Created ${outputPath}`);
