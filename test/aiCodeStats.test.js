import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { appendRecord } from "../src/tracker/csv.js";
import { authorCsvPath } from "../src/tracker/paths.js";
import { runAiCodeStats } from "../src/cli/ai-code-stats.js";

test("summarizes CSV records with filters", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-stats-"));
  await appendRecord(authorCsvPath(repoRoot, "cyd"), {
    author: "cyd",
    ai_lines: 3,
    total_lines: 6,
    is_ai_commit: true,
    commit_id: "abcdef1",
    date: "2026-05-05",
    message: "One",
  });
  await appendRecord(authorCsvPath(repoRoot, "other"), {
    author: "other",
    ai_lines: 1,
    total_lines: 4,
    is_ai_commit: false,
    commit_id: "abcdef2",
    date: "2026-05-06",
    message: "Two",
  });

  const result = await runAiCodeStats(["--author", "cyd"], { repoRoot, silent: true });

  assert.equal(result.totalLines, 6);
  assert.equal(result.aiLines, 3);
  assert.equal(result.aiGeneratedCommits, 1);
  assert.equal(result.trackedCommits, 1);
  assert.match(result.output, /AI ratio: 50\.0%/);
  assert.match(result.output, /AI-generated commits: 1/);
});
