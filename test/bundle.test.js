import test from "node:test";
import assert from "node:assert/strict";
import * as bundle from "../.opencode/skills/ai-code-tracker/scripts/bundle.js";

const expected = [
  "runCommitStats",
  "runAiCodeStats",
  "runAiCodeUpdate",
  "runInstall",
  "runClaudeCodeHook",
  "AiCodeTrackerPlugin",
  "recordEditedFile",
];

test("bundle exports all 7 public symbols", () => {
  for (const name of expected) {
    assert.ok(name in bundle, `missing export: ${name}`);
  }
});
