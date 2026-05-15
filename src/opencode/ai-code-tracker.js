import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { git, gitRepoRoot } from "../tracker/git.js";
import { appendPendingLines, loadPendingLines } from "../tracker/lineStore.js";
import { logInfo, startTimer } from "../tracker/logger.js";
import { addedLines, loadConfig, shouldIgnore, safeRead } from "../tracker/shared.js";

const beforeSnapshots = new Map();
const originalSnapshots = new Map();
const pendingFileEditedTimers = new Map();
const bashSnapshots = new Map();

export async function recordEditedFile({ cwd = process.cwd(), filePath, before, after = "", replace = false }) {
  const timer = startTimer();
  const repoRoot = await gitRepoRoot(cwd);
  const relative = path.relative(repoRoot, path.resolve(cwd, filePath)).replaceAll(path.sep, "/");

  const config = await loadConfig(repoRoot);
  if (!config.enabled) {
    await logInfo(repoRoot, "recordEditedFile", "skipped: disabled", { file: relative });
    return { skipped: "disabled" };
  }

  if (shouldIgnore(relative)) {
    await logInfo(repoRoot, "recordEditedFile", "skipped: ignored", { file: relative });
    return { skipped: "ignored" };
  }
  const isNewFile = before === undefined || before === null || before === "";
  const added = isNewFile ? String(after).split(/\r?\n/) : addedLines(before, after);
  await appendPendingLines(repoRoot, relative, added, {
    countBlankLines: config.count_blank_lines,
    dedupeExisting: true,
    replace,
  });
  await logInfo(repoRoot, "recordEditedFile", "recorded added lines", { file: relative, addedLines: added.length, newFile: isNewFile, durationMs: timer.elapsedMs() });
  return { recorded: added.length };
}

export const AiCodeTrackerPlugin = async ({ directory, worktree, client } = {}) => {
  const cwd = worktree ?? directory ?? process.cwd();

  let repoRootForLog;
  try {
    repoRootForLog = await gitRepoRoot(cwd);
  } catch {
    repoRootForLog = null;
  }

  await log(client, "info", "ai-code-tracker plugin initialized", { cwd });
  if (repoRootForLog) await logInfo(repoRootForLog, "plugin.init", "ai-code-tracker plugin initialized", { cwd });

  return {
    event: async ({ event }) => {
      if (event?.type !== "file.edited") return;
      const payload = event.properties ?? event;
      const filePath = payload.path ?? payload.file ?? payload.filePath;
      if (!filePath) return;

      const eventCwd = payload.cwd ?? cwd;
      if (repoRootForLog) await logInfo(repoRootForLog, "event.file-edited", "enter", { file: filePath });

      const key = snapshotKey(eventCwd, filePath);
      clearPendingFileEdited(key);
      pendingFileEditedTimers.set(key, setTimeout(async () => {
        pendingFileEditedTimers.delete(key);
        if (!beforeSnapshots.has(key)) return;
        await recordEditedFile({
          cwd: eventCwd,
          filePath,
          before: payload.before ?? payload.old ?? beforeSnapshots.get(key),
          after: await safeRead(path.resolve(eventCwd, filePath)),
        });
        beforeSnapshots.delete(key);
      }, 250));
    },

    "tool.execute.before": async (input, output) => {
      const tool = input?.tool ?? output?.tool;
      const toolName = String(tool ?? "").toLowerCase();
      const args = output?.args ?? input?.args ?? {};

      if (toolName.includes("bash")) {
        await handleBashBefore({ cwd, tool, args });
        return;
      }

      const filePath = extractFilePath(tool, args);
      if (!filePath) return;

      if (repoRootForLog) await logInfo(repoRootForLog, "tool.execute.before", "capturing snapshot", { tool: String(tool), file: filePath });
      const key = snapshotKey(cwd, filePath);
      const content = await safeRead(path.resolve(cwd, filePath));
      beforeSnapshots.set(key, content);
      if (!originalSnapshots.has(key)) originalSnapshots.set(key, content);
    },

    "tool.execute.after": async (input, output) => {
      const tool = input?.tool ?? output?.tool;
      const toolName = String(tool ?? "").toLowerCase();
      const args = output?.args ?? input?.args ?? {};

      if (toolName.includes("bash")) {
        await handleBashAfter({ cwd, tool, args });
        return;
      }

      const filePath = extractFilePath(tool, args);
      if (!filePath) return;

      if (repoRootForLog) await logInfo(repoRootForLog, "tool.execute.after", "processing edit", { tool: String(tool), file: filePath });

      const key = snapshotKey(cwd, filePath);
      clearPendingFileEdited(key);
      const before = originalSnapshots.get(key) ?? beforeSnapshots.get(key);
      beforeSnapshots.delete(key);

      await recordEditedFile({
        cwd,
        filePath,
        before,
        after: await safeRead(path.resolve(cwd, filePath)),
        replace: true,
      });
    },
  };
};

export default AiCodeTrackerPlugin;

async function handleBashBefore({ cwd, tool, args }) {
  try {
    const repoRoot = await gitRepoRoot(cwd);
    const hashes = await captureGitFileHashes(repoRoot);
    const toolUseId = args.id ?? args.toolUseId ?? Date.now().toString();
    bashSnapshots.set(toolUseId, { repoRoot, hashes });
    await logInfo(repoRoot, "tool.execute.before", "captured bash file hashes", { files: Object.keys(hashes).length });
  } catch (error) {
    await logInfo(cwd, "tool.execute.before", `bash-pre error: ${error.message}`);
  }
}

async function handleBashAfter({ cwd, tool, args }) {
  try {
    const toolUseId = args.id ?? args.toolUseId ?? Date.now().toString();
    const entry = bashSnapshots.get(toolUseId);
    if (!entry) return;

    const { repoRoot, hashes: prevHashes } = entry;
    bashSnapshots.delete(toolUseId);

    const config = await loadConfig(repoRoot);
    if (!config.enabled) return;

    const currentHashes = await captureGitFileHashes(repoRoot);
    const pending = await loadPendingLines(repoRoot);
    let trackedCount = 0;

    for (const [file, hash] of Object.entries(currentHashes)) {
      if (shouldIgnore(file)) continue;
      if (pending[file]) continue;
      if (prevHashes[file] === hash) continue;

      const absolutePath = path.join(repoRoot, file);
      const content = await safeRead(absolutePath);
      const lines = content.split(/\r?\n/).filter((l) => config.count_blank_lines || l.trim() !== "");
      if (lines.length > 0) {
        await appendPendingLines(repoRoot, file, lines, { countBlankLines: config.count_blank_lines, dedupeExisting: true });
        trackedCount++;
      }
    }

    await logInfo(repoRoot, "tool.execute.after", "bash-post processed", { trackedFiles: trackedCount });
  } catch (error) {
    await logInfo(cwd, "tool.execute.after", `bash-post error: ${error.message}`);
  }
}

async function captureGitFileHashes(repoRoot) {
  const [modifiedRaw, untrackedRaw] = await Promise.all([
    git(["diff", "--name-only"], { cwd: repoRoot }).catch(() => ""),
    git(["ls-files", "--others", "--exclude-standard"], { cwd: repoRoot }).catch(() => ""),
  ]);
  const files = [...new Set([
    ...modifiedRaw.split("\n").filter(Boolean),
    ...untrackedRaw.split("\n").filter(Boolean),
  ])];

  const hashes = {};
  await Promise.all(files.map(async (file) => {
    try {
      const content = await fs.readFile(path.join(repoRoot, file));
      hashes[file] = createHash("md5").update(content).digest("hex");
    } catch {
      hashes[file] = "";
    }
  }));
  return hashes;
}

function extractFilePath(tool, args) {
  const toolName = String(tool ?? "").toLowerCase();
  if (!["edit", "write", "patch"].some((name) => toolName.includes(name))) return null;
  return args.filePath ?? args.file_path ?? args.path ?? args.file;
}

function snapshotKey(cwd, filePath) {
  return path.resolve(cwd, filePath);
}

function clearPendingFileEdited(key) {
  const timer = pendingFileEditedTimers.get(key);
  if (!timer) return;
  clearTimeout(timer);
  pendingFileEditedTimers.delete(key);
}

async function log(client, level, message, extra = {}) {
  try {
    await client?.app?.log?.({
      body: {
        service: "ai-code-tracker",
        level,
        message,
        extra,
      },
    });
  } catch {
    // Logging must never break editing.
  }
}

