#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendRecord } from "../src/tracker/csv.js";
import { git } from "../src/tracker/git.js";
import { authorCsvPath, configPath } from "../src/tracker/paths.js";
import { runPushUpload } from "../src/tracker/pushUpload.js";

const DEFAULT_UPLOAD_URL = "http://127.0.0.1:8080/v1/records";
const ZERO_SHA = "0".repeat(40);
const SMOKE_ORIGIN = "https://github.com/ai-code-tracker/upload-smoke.git";

export async function runUploadSmokeTest({ uploadURL = process.env.AI_TRACKER_UPLOAD_URL || DEFAULT_UPLOAD_URL, keepTemp = false } = {}) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-code-tracker-upload-"));
  try {
    await git(["init", "-b", "main"], { cwd: repoRoot });
    await git(["config", "user.name", "AI Tracker Smoke Test"], { cwd: repoRoot });
    await git(["config", "user.email", "ai-tracker-smoke@example.invalid"], { cwd: repoRoot });
    await git(["remote", "add", "origin", SMOKE_ORIGIN], { cwd: repoRoot });
    await fs.writeFile(path.join(repoRoot, "README.md"), "AI Code Tracker upload smoke test\n", "utf8");
    await git(["add", "README.md"], { cwd: repoRoot });
    await git(["commit", "-m", "test: upload smoke record"], { cwd: repoRoot });

    const commitID = await git(["rev-parse", "HEAD"], { cwd: repoRoot });
    await fs.mkdir(path.dirname(configPath(repoRoot)), { recursive: true });
    await fs.writeFile(configPath(repoRoot), `${JSON.stringify({ enabled: true, uploadUrl: uploadURL })}\n`, "utf8");
    await appendRecord(authorCsvPath(repoRoot, "AI Tracker Smoke Test"), {
      author: "AI Tracker Smoke Test",
      ai_lines: 1,
      total_lines: 1,
      is_ai_commit: true,
      commit_id: commitID,
      date: formatDate(new Date()),
      message: "test: upload smoke record",
    });

    const result = await runPushUpload({
      repoRoot,
      stdin: `refs/heads/main ${commitID} refs/heads/main ${ZERO_SHA}\n`,
    });
    if (result.uploaded !== 1 || result.queued) {
      throw new Error(`upload failed: ${JSON.stringify(result)}`);
    }
    return { ...result, commitID, repositoryURL: SMOKE_ORIGIN, tempDir: keepTemp ? repoRoot : undefined };
  } finally {
    if (!keepTemp) await fs.rm(repoRoot, { recursive: true, force: true });
  }
}

function formatDate(value) {
  const parts = [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")];
  const time = [value.getHours(), value.getMinutes(), value.getSeconds()].map((part) => String(part).padStart(2, "0"));
  return `${parts.join("-")} ${time.join(":")}`;
}

function commandOptions(argumentsList) {
  let uploadURL = process.env.AI_TRACKER_UPLOAD_URL || DEFAULT_UPLOAD_URL;
  let keepTemp = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (argumentsList[index] === "--url") {
      uploadURL = argumentsList[index + 1] || "";
      index += 1;
    } else if (argumentsList[index] === "--keep") {
      keepTemp = true;
    }
  }
  if (!uploadURL) throw new Error("--url requires an endpoint URL");
  return { uploadURL, keepTemp };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runUploadSmokeTest(commandOptions(process.argv.slice(2)))
    .then((result) => console.log(`[ai-code-tracker] upload smoke test passed: ${result.commitID}`))
    .catch((error) => {
      console.error(`[ai-code-tracker] upload smoke test failed: ${error.message}`);
      process.exitCode = 1;
    });
}
