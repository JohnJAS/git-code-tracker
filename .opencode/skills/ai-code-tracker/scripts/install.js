#!/usr/bin/env node
import { runInstall } from "./bundle.js";

runInstall().then((result) => {
  if (result?.uninstalled) console.log("ai-code-tracker uninstalled");
  else if (result?.ok) console.log("ai-code-tracker installed");
}).catch((error) => {
  console.error(`[ai-code-tracker] ${error.message}`);
  process.exitCode = 1;
});
