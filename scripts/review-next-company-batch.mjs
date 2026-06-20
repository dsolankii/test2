import { spawnSync } from "node:child_process";

function runScript(scriptPath) {
  console.log("");
  console.log(`=== Running ${scriptPath} ===`);

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    throw new Error(`${scriptPath} failed with exit code ${result.status}`);
  }
}

runScript("scripts/enrich-company-batch-ai.mjs");
runScript("scripts/build-company-dashboard-dataset.mjs");

console.log("");
console.log("Strict review + dashboard build complete");
