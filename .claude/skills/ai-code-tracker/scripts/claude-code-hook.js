#!/usr/bin/env node
import { runClaudeCodeHook } from "../lib/index.js";

runClaudeCodeHook(process.argv[2]).catch(() => {
  // Never block Claude Code.
});
