import fs from "node:fs/promises";
import path from "node:path";
import { trackerDir } from "./paths.js";

const MAX_LOG_SIZE = 5 * 1024 * 1024;
const MAX_ARCHIVES = 3;

export async function logInfo(repoRoot, hook, message, extra = {}) {
  await writeLog(repoRoot, "INFO", hook, message, extra);
}

export async function logError(repoRoot, hook, message, extra = {}) {
  await writeLog(repoRoot, "ERROR", hook, message, extra);
}

export async function logDebug(repoRoot, hook, message, extra = {}) {
  await writeLog(repoRoot, "DEBUG", hook, message, extra);
}

export function startTimer() {
  const start = performance.now();
  return {
    elapsedMs() {
      return Math.round(performance.now() - start);
    },
  };
}

async function writeLog(repoRoot, level, hook, message, extra) {
  try {
    const dir = trackerDir(repoRoot);
    const logFile = path.join(dir, "plugin.log");

    await fs.mkdir(dir, { recursive: true });
    await rotateIfNeeded(logFile, dir);

    const timestamp = new Date().toISOString();
    const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
    const line = `[${timestamp}] [${level}] [${hook}] ${message}${extraStr}\n`;

    await fs.appendFile(logFile, line, "utf8");
  } catch {
    // Logging must never break operations.
  }
}

async function rotateIfNeeded(logFile, dir) {
  let stat;
  try {
    stat = await fs.stat(logFile);
  } catch {
    return;
  }

  if (stat.size < MAX_LOG_SIZE) return;

  for (let i = MAX_ARCHIVES - 1; i >= 1; i--) {
    const older = path.join(dir, `plugin.log.${i}`);
    const newer = path.join(dir, `plugin.log.${i - 1}`);
    const source = i === 1 ? logFile : newer;
    try {
      await fs.rename(source, older);
    } catch {
      // Missing archive is fine.
    }
  }

  try {
    await fs.rename(logFile, path.join(dir, "plugin.log.1"));
  } catch {
    // If rename fails, next append will start a fresh file anyway.
  }
}
