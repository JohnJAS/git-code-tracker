import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { authorCsvPath, pendingCommitPath, pendingLinesPath, trackerDir } from "../src/tracker/paths.js";

test("builds tracker paths inside repo root", () => {
  assert.equal(trackerDir("/repo"), path.join("/repo", ".ai-tracking"));
  assert.equal(pendingLinesPath("/repo"), path.join("/repo", ".ai-tracking", "pending-lines.json"));
  assert.equal(pendingCommitPath("/repo"), path.join("/repo", ".ai-tracking", "pending-commit.json"));
});

test("sanitizes author csv names", () => {
  assert.equal(authorCsvPath("/repo", "Cy D <x@y>"), path.join("/repo", ".ai-tracking", "Cy-D-x-y.csv"));
});
