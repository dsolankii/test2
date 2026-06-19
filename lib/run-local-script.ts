import { access } from "fs/promises";
import { constants } from "fs";
import { spawn } from "child_process";
import path from "path";
import {
  LEADGRID_BASE_DATA_DIR,
  getLeadgridWorkspaceId,
} from "@/lib/data-dir";
import { pullBlobData, pushBlobData } from "@/lib/blob-store";

export type RunLocalScriptResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
};

const isVercel = Boolean(process.env.VERCEL);

export async function scriptExists(scriptPath: string) {
  try {
    await access(path.join(process.cwd(), scriptPath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function assertScriptOk(result: RunLocalScriptResult, scriptPath: string) {
  if (result.ok) return;

  const details = [
    `Script failed: ${scriptPath}`,
    `Exit code: ${result.code ?? "unknown"}`,
    result.stderr ? `stderr:\n${result.stderr}` : "",
    result.stdout ? `stdout:\n${result.stdout}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const error = new Error(details) as Error & RunLocalScriptResult;
  error.ok = result.ok;
  error.code = result.code;
  error.stdout = result.stdout;
  error.stderr = result.stderr;
  throw error;
}

function runNodeScript(
  scriptPath: string,
  timeoutMs = 20 * 60 * 1000
): Promise<RunLocalScriptResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,

        // IMPORTANT:
        // Pass only the base data dir to scripts.
        // scripts/data-dir.mjs will append /users/<LEADGRID_USER_ID>.
        LEADGRID_DATA_DIR: LEADGRID_BASE_DATA_DIR,
        LEADGRID_USER_ID: getLeadgridWorkspaceId(),
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\nTimed out after ${timeoutMs}ms`.trim(),
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
      });
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });
  });
}

export async function runLocalScript(
  scriptPath: string,
  timeoutMs = 20 * 60 * 1000
): Promise<RunLocalScriptResult> {
  const isBlobScript =
    scriptPath.includes("blob-pull") ||
    scriptPath.includes("blob-push") ||
    scriptPath.includes("blob-sync");

  if (isBlobScript) {
    if (isVercel) {
      if (scriptPath.includes("blob-pull")) {
        await pullBlobData();
      } else {
        await pushBlobData();
      }

      return {
        ok: true,
        code: 0,
        stdout: `${scriptPath} completed through imported Blob SDK`,
        stderr: "",
      };
    }

    const result = await runNodeScript(scriptPath, timeoutMs);
    assertScriptOk(result, scriptPath);
    return result;
  }

  if (!isVercel) {
    const result = await runNodeScript(scriptPath, timeoutMs);
    assertScriptOk(result, scriptPath);
    return result;
  }

  await pullBlobData();

  const result = await runNodeScript(scriptPath, timeoutMs);
  assertScriptOk(result, scriptPath);

  await pushBlobData();

  return result;
}
