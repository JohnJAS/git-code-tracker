#!/usr/bin/env node
import { runAiCodeStats } from "./bundle.js";

runAiCodeStats().catch((error) => {
  console.error(`[ai-code-tracker] ${error.message}`);
  process.exitCode = 1;
});
