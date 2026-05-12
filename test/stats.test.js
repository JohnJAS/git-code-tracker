import test from "node:test";
import assert from "node:assert/strict";
import { buildPendingCommit } from "../src/tracker/stats.js";

test("matches AI lines with duplicate-sensitive multiset semantics", () => {
  const pendingLines = {
    "src/a.js": ["same", "same", "ai only"],
  };
  const addedLines = {
    "src/a.js": ["same", "same", "same", "human"],
  };

  assert.deepEqual(buildPendingCommit({ pendingLines, addedLines }), {
    ai_lines: 2,
    total_lines: 4,
    matched_lines: {
      "src/a.js": ["same", "same"],
    },
  });
});

test("returns an empty pending commit when there are no added lines", () => {
  assert.deepEqual(buildPendingCommit({ pendingLines: {}, addedLines: {} }), {
    ai_lines: 0,
    total_lines: 0,
    matched_lines: {},
  });
});
