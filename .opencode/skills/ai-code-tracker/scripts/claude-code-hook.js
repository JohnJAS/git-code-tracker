#!/usr/bin/env node
import { runClaudeCodeHook } from "./bundle.js";

runClaudeCodeHook(process.argv[2]).catch(() => {
  // Never block Claude Code.
});
