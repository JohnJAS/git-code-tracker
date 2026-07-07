#!/usr/bin/env node
import { runAiCodeUpdate } from "../lib/index.js";

runAiCodeUpdate().catch((error) => {
  console.error(`[ai-code-tracker] ${error.message}`);
  process.exitCode = 1;
});
