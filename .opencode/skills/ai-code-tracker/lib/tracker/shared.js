import fs from "node:fs/promises";
import { configPath } from "./paths.js";

export function addedLines(before, after) {
  const bLines = String(before).split(/\r?\n/);
  const aLines = String(after).split(/\r?\n/);
  const diff = myersDiff(bLines, aLines);
  return diff.filter((op) => op.type === "insert").map((op) => op.line);
}

// Myers diff — returns a sequence of {type: "keep"|"delete"|"insert", line} operations
function myersDiff(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) { return []; }

  const v = new Int32Array(2 * max + 1).fill(max + 1);
  const trace = [];
  const offset = max;

  v[offset + 1] = 0;
  let done = false;
  for (let d = 0; d <= max && !done; d++) {
    trace.push(Int32Array.from(v));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { done = true; break; }
    }
  }

  // Backtrack to produce the edit script
  const ops = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vPrev = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && vPrev[offset + k - 1] < vPrev[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vPrev[offset + prevK];
    const prevY = prevX - prevK;

    // Diagonal (keep)
    while (x > prevX && y > prevY) {
      x--; y--;
      ops.push({ type: "keep", line: a[x] });
    }

    if (d > 0) {
      if (x === prevX) {
        // Insert b[y]
        y--;
        ops.push({ type: "insert", line: b[y] });
      } else {
        // Delete a[x]
        x--;
        ops.push({ type: "delete", line: a[x] });
      }
    }
  }

  ops.reverse();
  return ops;
}

export async function loadConfig(repoRoot) {
  try {
    return JSON.parse(await fs.readFile(configPath(repoRoot), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      const { logError } = await import("./logger.js");
      await logError(repoRoot, "loadConfig", "failed to read config, using defaults", { error: error.message });
    }
    return { enabled: true, countBlankLines: false, trackingCommitSuffix: "[ai-tracking]", autoTrackingCommit: true };
  }
}

const DEFAULT_IGNORE = [
  ".ai-tracking/**",
  ".git/**",
  "node_modules/**",
  "dist/**",
  "build/**",
];

export function shouldIgnore(filePath, patterns = DEFAULT_IGNORE) {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) { return filePath.startsWith(pattern.slice(0, -3)); }
    return filePath === pattern;
  });
}

export async function safeRead(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}
