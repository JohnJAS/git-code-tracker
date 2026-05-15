import fs from "node:fs/promises";
import path from "node:path";
import { gitRepoRoot } from "../tracker/git.js";
import { appendPendingLines } from "../tracker/lineStore.js";
import { logInfo, startTimer } from "../tracker/logger.js";
import { addedLines, loadConfig, shouldIgnore, safeRead } from "../tracker/shared.js";

const beforeSnapshots = new Map();
const originalSnapshots = new Map();
const pendingFileEditedTimers = new Map();

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
      const args = output?.args ?? input?.args ?? {};
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
      const args = output?.args ?? input?.args ?? {};
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

