import test from "node:test";
import assert from "node:assert/strict";
import * as lib from "../.opencode/skills/ai-code-tracker/lib/index.js";

const expected = [
  "runCommitStats",
  "runAiCodeStats",
  "runAiCodeUpdate",
  "runInstall",
  "runClaudeCodeHook",
  "AiCodeTrackerPlugin",
  "recordEditedFile",
];

test("lib/index.js exports all 7 public symbols", () => {
  for (const name of expected) {
    assert.ok(name in lib, `missing export: ${name}`);
  }
});
