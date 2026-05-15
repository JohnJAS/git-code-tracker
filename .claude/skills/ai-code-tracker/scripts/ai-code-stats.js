#!/usr/bin/env node
import { runAiCodeStats } from "../lib/cli/ai-code-stats.js";

runAiCodeStats().catch((error) => {
  console.error(`[ai-code-tracker] ${error.message}`);
  process.exitCode = 1;
});
