import test from "node:test";
import assert from "node:assert/strict";
import { authorCsvPath, pendingCommitPath, pendingLinesPath, trackerDir } from "../src/tracker/paths.js";

test("builds tracker paths inside repo root", () => {
  assert.equal(trackerDir("/repo"), "/repo/.ai-tracking");
  assert.equal(pendingLinesPath("/repo"), "/repo/.ai-tracking/pending-lines.json");
  assert.equal(pendingCommitPath("/repo"), "/repo/.ai-tracking/pending-commit.json");
});

test("sanitizes author csv names", () => {
  assert.equal(authorCsvPath("/repo", "Cy D <x@y>"), "/repo/.ai-tracking/Cy-D-x-y.csv");
});
