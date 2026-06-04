import test from "node:test";
import assert from "node:assert/strict";

test("ai-update exports runAiCodeUpdate", async () => {
  const mod = await import("../src/cli/ai-update.js");
  assert.equal(typeof mod.runAiCodeUpdate, "function");
});
