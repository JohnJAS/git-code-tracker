#!/usr/bin/env node
import { runCommitStats } from "../lib/index.js";

runCommitStats(process.argv[2]).catch((error) => {
  console.error(`[ai-code-tracker] ${error.message}`);
  process.exitCode = 1;
});
