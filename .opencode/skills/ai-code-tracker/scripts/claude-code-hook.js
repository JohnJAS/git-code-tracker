#!/usr/bin/env node
import { runClaudeCodeHook } from "../lib/cli/claude-code-hook.js";

runClaudeCodeHook(process.argv[2]).catch(() => {
  // Never block Claude Code.
});
