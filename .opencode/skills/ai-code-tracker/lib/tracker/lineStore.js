import fs from "node:fs/promises";
import { lockPath, pendingLinesPath } from "./paths.js";
import { atomicWriteJson, withFileLock } from "./lock.js";

export async function loadPendingLines(repoRoot) {
  const file = pendingLinesPath(repoRoot);
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    return migrateStore(raw);
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
    const existing = new Set(existingContents(pending, filePath));
    const additions = [];
    for (const line of lines) {
      if (!countBlankLines && line.trim() === "") continue;
      if (dedupeExisting && existing.has(line)) continue;
      existing.add(line);
      additions.push({ content: line, consumed: false });
    }
    if (additions.length === 0) return pending;
    pending[filePath] = [...(pending[filePath] ?? []), ...additions];
    await savePendingLines(repoRoot, pending);
    return pending;
  }, { operation: "record pending AI lines" });
}

export function consumeMatchedLines(pending, matched) {
  const next = normalizeStore(pending);

  for (const [filePath, lines] of Object.entries(matched ?? {})) {
    const entries = next[filePath] ?? [];
    const matchPool = [...lines];
    for (const entry of entries) {
      if (entry.consumed) continue;
      const index = matchPool.indexOf(entry.content);
      if (index === -1) continue;
      entry.consumed = true;
      matchPool.splice(index, 1);
    }
  }

  return next;
}

function normalizeStore(data) {
  const out = {};
  for (const [filePath, entries] of Object.entries(data ?? {})) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const cleaned = entries.filter(isValidEntry);
    if (cleaned.length > 0) out[filePath] = cleaned;
  }
  return out;
}

function isValidEntry(entry) {
  return entry && typeof entry.content === "string";
}

function migrateStore(data) {
  const out = {};
  for (const [filePath, entries] of Object.entries(data ?? {})) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    out[filePath] = entries.map((entry) =>
      typeof entry === "string" ? { content: entry, consumed: false } : entry,
    );
  }
  return out;
}

function existingContents(pending, filePath) {
  return (pending[filePath] ?? []).map((e) =>
    typeof e === "string" ? e : e.content,
  );
}
