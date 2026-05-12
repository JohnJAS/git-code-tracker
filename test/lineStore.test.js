import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { appendPendingLines, consumeMatchedLines, loadPendingLines } from "../src/tracker/lineStore.js";

test("appends nonblank pending lines and preserves duplicates", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-lines-"));

  await appendPendingLines(repoRoot, "src/a.js", ["one", "", "one"]);

  assert.deepEqual(await loadPendingLines(repoRoot), {
    "src/a.js": ["one", "one"],
  });
});

test("consumes only matched line counts", () => {
  assert.deepEqual(
    consumeMatchedLines(
      { "src/a.js": ["one", "one", "two"] },
      { "src/a.js": ["one"] },
    ),
    { "src/a.js": ["one", "two"] },
  );
});
