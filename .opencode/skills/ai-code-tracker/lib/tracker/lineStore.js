import fs from "node:fs/promises";
import { lockPath, pendingLinesPath } from "./paths.js";
import { atomicWriteJson, withFileLock } from "./lock.js";

export async function loadPendingLines(repoRoot) {
  const file = pendingLinesPath(repoRoot);
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export async function savePendingLines(repoRoot, data) {
  await atomicWriteJson(pendingLinesPath(repoRoot), normalizeStore(data), {
    operation: "write pending AI lines",
  });
}

export async function appendPendingLines(repoRoot, filePath, lines, options = {}) {
  const countBlankLines = options.countBlankLines ?? false;
  const dedupeExisting = options.dedupeExisting ?? false;
  return withFileLock(lockPath(repoRoot, "pending-lines"), async () => {
    const pending = await loadPendingLines(repoRoot);
    const existing = new Set(pending[filePath] ?? []);
    const additions = lines.filter((line) => {
      if (!countBlankLines && line.trim() === "") return false;
      if (dedupeExisting && existing.has(line)) return false;
      existing.add(line);
      return true;
    });
    if (additions.length === 0) return pending;
    pending[filePath] = [...(pending[filePath] ?? []), ...additions];
    await savePendingLines(repoRoot, pending);
    return pending;
  }, { operation: "record pending AI lines" });
}

export function consumeMatchedLines(pending, matched) {
  const next = normalizeStore(pending);

  for (const [filePath, lines] of Object.entries(matched ?? {})) {
    const current = [...(next[filePath] ?? [])];
    for (const line of lines) {
      const index = current.indexOf(line);
      if (index !== -1) current.splice(index, 1);
    }
    if (current.length > 0) {
      next[filePath] = current;
    } else {
      delete next[filePath];
    }
  }

  return next;
}

function normalizeStore(data) {
  const out = {};
  for (const [filePath, lines] of Object.entries(data ?? {})) {
    if (Array.isArray(lines) && lines.length > 0) out[filePath] = [...lines];
  }
  return out;
}
