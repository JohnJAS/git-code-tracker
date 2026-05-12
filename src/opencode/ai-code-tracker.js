import fs from "node:fs/promises";
import path from "node:path";
import { gitRepoRoot } from "../tracker/git.js";
import { appendPendingLines } from "../tracker/lineStore.js";
import { configPath } from "../tracker/paths.js";

const beforeSnapshots = new Map();
const pendingFileEditedTimers = new Map();

export async function recordEditedFile({ cwd = process.cwd(), filePath, before, after = "" }) {
  const repoRoot = await gitRepoRoot(cwd);
  const config = await loadConfig(repoRoot);
  if (!config.enabled) return { skipped: "disabled" };

  const relative = path.relative(repoRoot, path.resolve(cwd, filePath)).replaceAll(path.sep, "/");
  if (shouldIgnore(relative, config.ignore ?? [])) return { skipped: "ignored" };
  if (before === undefined || before === null) return { skipped: "missing-before-snapshot" };
  if (before === "") return { skipped: "empty-before-snapshot" };

  const added = addedLines(before, after);
  await appendPendingLines(repoRoot, relative, added, {
    countBlankLines: config.count_blank_lines,
    dedupeExisting: true,
  });
  return { recorded: added.length };
}

export const AiCodeTrackerPlugin = async ({ directory, worktree, client } = {}) => {
  const cwd = worktree ?? directory ?? process.cwd();

  await log(client, "info", "ai-code-tracker plugin initialized", { cwd });

  return {
    event: async ({ event }) => {
      if (event?.type !== "file.edited") return;
      const payload = event.properties ?? event;
      const filePath = payload.path ?? payload.file ?? payload.filePath;
      if (!filePath) return;

      const eventCwd = payload.cwd ?? cwd;
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

      beforeSnapshots.set(snapshotKey(cwd, filePath), await safeRead(path.resolve(cwd, filePath)));
    },

    "tool.execute.after": async (input, output) => {
      const tool = input?.tool ?? output?.tool;
      const args = output?.args ?? input?.args ?? {};
      const filePath = extractFilePath(tool, args);
      if (!filePath) return;

      const key = snapshotKey(cwd, filePath);
      clearPendingFileEdited(key);
      const before = beforeSnapshots.get(key);
      beforeSnapshots.delete(key);

      await recordEditedFile({
        cwd,
        filePath,
        before,
        after: await safeRead(path.resolve(cwd, filePath)),
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

async function safeRead(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
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

function addedLines(before, after) {
  const remaining = new Map();
  for (const line of String(before).split(/\r?\n/)) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }

  const added = [];
  for (const line of String(after).split(/\r?\n/)) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      remaining.set(line, count - 1);
    } else {
      added.push(line);
    }
  }
  return added;
}

async function loadConfig(repoRoot) {
  try {
    return JSON.parse(await fs.readFile(configPath(repoRoot), "utf8"));
  } catch {
    return { enabled: false };
  }
}

function shouldIgnore(filePath, patterns) {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) return filePath.startsWith(pattern.slice(0, -3));
    return filePath === pattern;
  });
}
