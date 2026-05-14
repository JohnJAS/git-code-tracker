#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { git, gitRepoRoot } from "../tracker/git.js";
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

  const toolName = input.tool_name;
  const toolUseId = input.tool_use_id;
  const cwd = input.cwd ?? process.cwd();

  if (!toolUseId) return;

  let repoRoot;
  try {
    repoRoot = await gitRepoRoot(toPosixPath(cwd));
  } catch {
    return;
  }

  const config = await loadConfig(repoRoot);
  if (!config.enabled) return;

  if (toolName === "Bash") {
    if (mode === "pre") {
      await handleBashPre({ repoRoot, toolUseId });
    } else if (mode === "post") {
      await handleBashPost({ repoRoot, toolUseId, config });
    }
    return;
  }

  const filePath = input.tool_input?.file_path;
  if (!filePath) return;

  const absolutePath = path.resolve(toPosixPath(cwd), toPosixPath(filePath));
  const relative = path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/");

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

async function handleBashPre({ repoRoot, toolUseId }) {
  try {
    await cleanStaleSnapshots(repoRoot);

    const state = await captureGitFileState(repoRoot);
    const dir = snapshotDir(repoRoot);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `bash-${toolUseId}.json`), JSON.stringify(state), "utf8");

    await logInfo(repoRoot, "claude-code.bash-pre", "captured git state");
  } catch (error) {
    await logError(repoRoot, "claude-code.bash-pre", error.message);
  }
}

async function handleBashPost({ repoRoot, toolUseId, config }) {
  try {
    const dir = snapshotDir(repoRoot);
    const snapshotFile = path.join(dir, `bash-${toolUseId}.json`);

    let prevState;
    try {
      prevState = JSON.parse(await fs.readFile(snapshotFile, "utf8"));
    } catch {
      return;
    }

    const currentState = await captureGitFileState(repoRoot);
    const prevSet = new Set([...prevState.modified, ...prevState.untracked]);
    const curSet = new Set([...currentState.modified, ...currentState.untracked]);

    const newOrChanged = [...curSet].filter((f) => !prevSet.has(f));

    if (newOrChanged.length > 0) {
      const { loadPendingLines } = await import("../tracker/lineStore.js");
      const pending = await loadPendingLines(repoRoot);

      for (const file of newOrChanged) {
        if (shouldIgnore(file, config.ignore ?? [])) continue;
        if (pending[file]) continue;

        const absolutePath = path.join(repoRoot, file);
        const content = await safeRead(absolutePath);
        const lines = content.split(/\r?\n/).filter((l) => config.count_blank_lines || l.trim() !== "");
        if (lines.length > 0) {
          await appendPendingLines(repoRoot, file, lines, { countBlankLines: config.count_blank_lines, dedupeExisting: true });
        }
      }
    }

    await fs.rm(snapshotFile, { force: true });
    await logInfo(repoRoot, "claude-code.bash-post", "processed", { newFiles: newOrChanged.length });
  } catch (error) {
    await logError(repoRoot, "claude-code.bash-post", error.message);
  }
}

async function captureGitFileState(repoRoot) {
  const [modified, untracked] = await Promise.all([
    git(["diff", "--name-only"], { cwd: repoRoot }).catch(() => ""),
    git(["ls-files", "--others", "--exclude-standard"], { cwd: repoRoot }).catch(() => ""),
  ]);
  return {
    modified: modified.split("\n").filter(Boolean),
    untracked: untracked.split("\n").filter(Boolean),
  };
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
