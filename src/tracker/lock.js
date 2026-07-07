import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_MS = 50;

export async function withFileLock(lockFile, fn, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const started = Date.now();

  await fs.mkdir(path.dirname(lockFile), { recursive: true });

  while (true) {
    try {
      const handle = await fs.open(lockFile, "wx");
      try {
        await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
      } finally {
        await handle.close();
      }

      try {
        return await fn();
      } finally {
        await fs.rm(lockFile, { force: true });
      }
    } catch (error) {
      if (error.code !== "EEXIST") { throw error; }
      if (Date.now() - started >= timeoutMs) {
        const lockError = new Error(`Timed out waiting for lock: ${lockFile}`);
        await writeRecoveryLog(lockFile, lockError, {
          operation: options.operation ?? "acquire tracker lock",
          relatedPath: lockFile,
        });
        throw lockError;
      }
      await sleep(pollMs);
    }
  }
}

export async function atomicWriteJson(targetPath, data, options = {}) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${options.tempSuffix ?? `${process.pid}.${Date.now()}.tmp`}`;
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tmpPath, targetPath);
  } catch (error) {
    await writeRecoveryLog(targetPath, error, {
      operation: options.operation ?? "write tracker JSON file",
      relatedPath: targetPath,
    });
    throw error;
  }
}

export async function atomicWriteText(targetPath, text, options = {}) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${options.tempSuffix ?? `${process.pid}.${Date.now()}.tmp`}`;
  try {
    await fs.writeFile(tmpPath, text, "utf8");
    await fs.rename(tmpPath, targetPath);
  } catch (error) {
    await writeRecoveryLog(targetPath, error, {
      operation: options.operation ?? "write tracker text file",
      relatedPath: targetPath,
    });
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeRecoveryLog(filePath, error, { operation, relatedPath }) {
  const tracker = findTrackerDir(filePath);
  if (!tracker) { return; }

  const message = [
    `[${new Date().toISOString()}] ${operation}`,
    `path: ${relatedPath}`,
    `error: ${error.code ? `${error.code}: ` : ""}${error.message}`,
    "recovery: release or delete the stale .lock/tmp file if no tracker process is using it, then retry the same opencode edit or git action.",
    "",
  ].join("\n");

  try {
    await fs.mkdir(tracker, { recursive: true });
    await fs.appendFile(path.join(tracker, "errors.log"), message, "utf8");
  } catch {
    // Error logging is best-effort; preserve the original failure.
  }
}

function findTrackerDir(filePath) {
  const parts = path.resolve(filePath).split(path.sep);
  const index = parts.lastIndexOf(".ai-tracking");
  if (index === -1) { return null; }
  return parts.slice(0, index + 1).join(path.sep) || path.sep;
}
