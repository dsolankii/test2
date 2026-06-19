import { writeFile, mkdir } from "fs/promises";
import { DATA_DIR, dataPath } from "./data-dir.mjs";

await mkdir(DATA_DIR, { recursive: true });

const startedAt = new Date().toISOString();
const runId = `run_${startedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;

await writeFile(
  dataPath("current-live-run.json"),
  JSON.stringify(
    {
      runId,
      startedAt,
    },
    null,
    2
  )
);

await writeFile(dataPath("ai-enriched-company-leads.json"), "[]\n");
await writeFile(dataPath("ai-enriched-company-leads.csv"), "companyName\n");

await writeFile(dataPath("company-dashboard-leads.json"), "[]\n");
await writeFile(dataPath("company-dashboard-leads.csv"), "companyName\n");

await writeFile(dataPath("raw-company-mentions.json"), "[]\n");

await writeFile(
  dataPath("leadgrid-visible-state.json"),
  JSON.stringify(
    {
      currentPage: 0,
      maxUnlockedPage: 0,
      pageSize: 50,
    },
    null,
    2
  )
);

console.log("Fresh run started");
console.log(`Run ID: ${runId}`);
console.log("Old reviewed queue cleared");
