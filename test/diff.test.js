import test from "node:test";
import assert from "node:assert/strict";
import { parseAddedLinesFromDiff } from "../src/tracker/diff.js";

test("parses added lines from unified diff", () => {
  const diff = `diff --git a/src/a.js b/src/a.js
index 111..222 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1 +1,3 @@
-old line
+line one
+line two
 diff --git a/bin.dat b/bin.dat
 Binary files a/bin.dat and b/bin.dat differ
`;

  assert.deepEqual(parseAddedLinesFromDiff(diff), {
    "src/a.js": ["line one", "line two"],
  });
});
