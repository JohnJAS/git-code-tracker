#!/usr/bin/env node
import { runCommitStats } from "../lib/cli/commit-stats.js";

runCommitStats(process.argv[2]).catch((error) => {
  console.error(`[ai-code-tracker] ${error.message}`);
  process.exitCode = 1;
});
