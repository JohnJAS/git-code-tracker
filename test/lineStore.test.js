import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { appendPendingLines, consumeMatchedLines, loadPendingLines } from "../src/tracker/lineStore.js";

const E = (content, consumed = false) => ({ content, consumed });

test("appends nonblank pending lines with consumed=false", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-lines-"));

  await appendPendingLines(repoRoot, "src/a.js", ["one", "", "one"]);

  assert.deepEqual(await loadPendingLines(repoRoot), {
    "src/a.js": [E("one"), E("one")],
  });
});

test("marks matched lines as consumed instead of removing them", () => {
  const result = consumeMatchedLines(
    { "src/a.js": [E("one"), E("one"), E("two")] },
    { "src/a.js": ["one"] },
  );

  assert.deepEqual(result, {
    "src/a.js": [E("one", true), E("one", false), E("two", false)],
  });
});

test("does not re-consume already consumed lines", () => {
  const result = consumeMatchedLines(
    { "src/a.js": [E("one", true), E("one", false), E("two", false)] },
    { "src/a.js": ["one"] },
  );

  assert.deepEqual(result, {
    "src/a.js": [E("one", true), E("one", true), E("two", false)],
  });
});

test("consumes across multiple files", () => {
  const result = consumeMatchedLines(
    {
      "src/a.js": [E("x"), E("y")],
      "src/b.ts": [E("z")],
    },
    { "src/a.js": ["x"], "src/b.ts": ["z"] },
  );

  assert.deepEqual(result, {
    "src/a.js": [E("x", true), E("y", false)],
    "src/b.ts": [E("z", true)],
  });
});

test("ignores matched lines for files not in the store", () => {
  const result = consumeMatchedLines(
    { "src/a.js": [E("x")] },
    { "src/other.js": ["x"] },
  );

  assert.deepEqual(result, {
    "src/a.js": [E("x", false)],
  });
});

test("loadPendingLines migrates legacy string array format", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-lines-"));
  const { pendingLinesPath } = await import("../src/tracker/paths.js");
  await fs.mkdir(path.join(repoRoot, ".ai-tracking"), { recursive: true });
  const raw = { "src/a.js": ["old-line-1", "old-line-2"] };
  await fs.writeFile(pendingLinesPath(repoRoot), JSON.stringify(raw), "utf8");

  const loaded = await loadPendingLines(repoRoot);
  assert.deepEqual(loaded, {
    "src/a.js": [E("old-line-1"), E("old-line-2")],
  });
});
