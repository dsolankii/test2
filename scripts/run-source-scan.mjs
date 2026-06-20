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

runScript("scripts/collect-sources.mjs");
runScript("scripts/collect-extra-sources.mjs");
runScript("scripts/collect-saas-conference-pages.mjs");

console.log("");
console.log("Source scan complete");
