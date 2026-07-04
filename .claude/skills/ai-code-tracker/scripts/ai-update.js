#!/usr/bin/env node
import { runAiCodeUpdate } from "./bundle.js";

runAiCodeUpdate().catch((error) => {
  console.error(`[ai-code-tracker] ${error.message}`);
  process.exitCode = 1;
});
