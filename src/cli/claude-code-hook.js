#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { gitRepoRoot } from "../tracker/git.js";
import { appendPendingLines } from "../tracker/lineStore.js";
import { snapshotDir } from "../tracker/paths.js";
import { logInfo, logError } from "../tracker/logger.js";
import { addedLines, loadConfig, shouldIgnore, safeRead } from "../tracker/shared.js";

const STALE_MS = 10 * 60 * 1000;

export async function runClaudeCodeHook(mode, options = {}) {
  const stdin = options.stdin ?? await readStdin();
  let input;
  try {
    input = JSON.parse(stdin);
  } catch {
    return;
  }

  const filePath = input.tool_input?.file_path;
  const toolUseId = input.tool_use_id;
  const cwd = input.cwd ?? process.cwd();

  if (!filePath || !toolUseId) return;

  let repoRoot;
  try {
    repoRoot = await gitRepoRoot(toPosixPath(cwd));
  } catch {
    return;
  }

  const absolutePath = path.resolve(toPosixPath(cwd), toPosixPath(filePath));
  const relative = path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/");
  const config = await loadConfig(repoRoot);

  if (!config.enabled) return;
  if (shouldIgnore(relative, config.ignore ?? [])) return;

  if (mode === "pre") {
    await handlePre({ repoRoot, absolutePath, relative, toolUseId });
  } else if (mode === "post") {
    await handlePost({ repoRoot, absolutePath, relative, toolUseId, config });
  }
}

async function handlePre({ repoRoot, absolutePath, relative, toolUseId }) {
  try {
    await cleanStaleSnapshots(repoRoot);

    const dir = snapshotDir(repoRoot);
    await fs.mkdir(dir, { recursive: true });

    const before = await safeRead(absolutePath);
    const snapshot = { content: before, filePath: relative, timestamp: Date.now() };
    await fs.writeFile(path.join(dir, `${toolUseId}.json`), JSON.stringify(snapshot), "utf8");

    await logInfo(repoRoot, "claude-code.pre", "captured snapshot", { file: relative });
  } catch (error) {
    await logError(repoRoot, "claude-code.pre", error.message, { file: relative });
  }
}

async function handlePost({ repoRoot, absolutePath, relative, toolUseId, config }) {
  try {
    const dir = snapshotDir(repoRoot);
    const snapshotFile = path.join(dir, `${toolUseId}.json`);

    let snapshot;
    try {
      snapshot = JSON.parse(await fs.readFile(snapshotFile, "utf8"));
    } catch {
      return;
    }

    const after = await safeRead(absolutePath);
    const added = addedLines(snapshot.content, after);

    if (added.length > 0) {
      await appendPendingLines(repoRoot, relative, added, {
        countBlankLines: config.count_blank_lines,
        dedupeExisting: true,
      });
    }

    await fs.rm(snapshotFile, { force: true });
    await logInfo(repoRoot, "claude-code.post", "recorded added lines", { file: relative, addedLines: added.length });
  } catch (error) {
    await logError(repoRoot, "claude-code.post", error.message, { file: relative });
  }
}

async function cleanStaleSnapshots(repoRoot) {
  const dir = snapshotDir(repoRoot);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }

  const cutoff = Date.now() - STALE_MS;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const stat = await fs.stat(path.join(dir, entry));
      if (stat.mtimeMs < cutoff) await fs.rm(path.join(dir, entry), { force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

function toPosixPath(p) {
  return String(p).replaceAll("\\", "/");
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runClaudeCodeHook(process.argv[2]).catch(() => {
    // Never block Claude Code.
  });
}
