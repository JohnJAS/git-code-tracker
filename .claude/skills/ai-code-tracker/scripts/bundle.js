var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/tracker/paths.js
import path from "node:path";
function trackerDir(repoRoot) {
  return path.join(repoRoot, ".ai-tracking");
}
function opencodePluginPath(repoRoot) {
  return path.join(repoRoot, ".opencode", "plugins", "ai-code-tracker.js");
}
function pendingLinesPath(repoRoot) {
  return path.join(trackerDir(repoRoot), "pending-lines.json");
}
function pendingCommitPath(repoRoot) {
  return path.join(trackerDir(repoRoot), "pending-commit.json");
}
function trackingMessagePath(repoRoot) {
  return path.join(trackerDir(repoRoot), "tracking-message.txt");
}
function archiveDir(repoRoot) {
  return path.join(trackerDir(repoRoot), "archive");
}
function configPath(repoRoot) {
  return path.join(trackerDir(repoRoot), "config.json");
}
function lockPath(repoRoot, name) {
  return path.join(trackerDir(repoRoot), `${name}.lock`);
}
function snapshotDir(repoRoot) {
  return path.join(trackerDir(repoRoot), "snapshots");
}
function authorCsvPath(repoRoot, author) {
  return path.join(trackerDir(repoRoot), `${safeFileName(author)}.csv`);
}
function safeFileName(value) {
  return String(value || "unknown").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
var init_paths = __esm({
  "src/tracker/paths.js"() {
  }
});

// src/tracker/csv.js
var csv_exports = {};
__export(csv_exports, {
  CSV_HEADER: () => CSV_HEADER,
  appendRecord: () => appendRecord,
  parseCsv: () => parseCsv,
  pruneStaleRecords: () => pruneStaleRecords,
  readRecords: () => readRecords,
  removeRecords: () => removeRecords
});
import fs from "node:fs/promises";
import path2 from "node:path";
function escapeCsv(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}
function formatRecord(record) {
  return [
    record.author,
    record.ai_lines,
    record.total_lines,
    Boolean(record.is_ai_commit),
    record.commit_id,
    record.date,
    record.message
  ].map(escapeCsv).join(",");
}
async function appendRecord(csvPath, record) {
  await fs.mkdir(path2.dirname(csvPath), { recursive: true });
  let records = [];
  try {
    records = parseCsv(await fs.readFile(csvPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  if (!records.some((existing) => existing.commit_id === record.commit_id)) {
    records.push(normalizeRecord(record));
  }
  await writeRecords(csvPath, records);
}
async function removeRecords(csvPath, predicate) {
  let records = [];
  try {
    records = parseCsv(await fs.readFile(csvPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return;
  }
  const kept = records.filter((r) => !predicate(r));
  if (kept.length !== records.length) {
    await writeRecords(csvPath, kept);
  }
}
async function readRecords(repoRoot) {
  const dir = trackerDir(repoRoot);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const records = [];
  for (const entry of entries) {
    if (!entry.endsWith(".csv")) {
      continue;
    }
    const text = await fs.readFile(path2.join(dir, entry), "utf8");
    records.push(...parseCsv(text));
  }
  return records;
}
async function pruneStaleRecords(repoRoot, isCommitInHistory, author) {
  const dir = trackerDir(repoRoot);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { pruned: 0 };
    }
    throw error;
  }
  const authorFilename = author ? `${safeFileName(author)}.csv` : null;
  let pruned = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".csv")) {
      continue;
    }
    if (authorFilename && entry !== authorFilename) {
      continue;
    }
    const csvPath = path2.join(dir, entry);
    const records = parseCsv(await fs.readFile(csvPath, "utf8"));
    const kept = [];
    for (const record of records) {
      if (await isCommitInHistory(record.commit_id)) {
        kept.push(record);
      } else {
        pruned += 1;
      }
    }
    if (kept.length !== records.length) {
      await writeRecords(csvPath, kept);
    }
  }
  return { pruned };
}
async function writeRecords(csvPath, records) {
  await fs.mkdir(path2.dirname(csvPath), { recursive: true });
  const lines = [CSV_HEADER, ...records.map((record) => formatRecord(normalizeRecord(record)))];
  await fs.writeFile(csvPath, `\uFEFF${lines.join("\n")}
`, "utf8");
}
function parseCsv(text) {
  const rows = parseRows(text.replace(/^﻿/, ""));
  if (rows.length === 0) {
    return [];
  }
  const [header, ...dataRows] = rows;
  return dataRows.filter((row) => row.length > 1 || row[0] !== "").map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] ?? ""]))).map((row) => ({
    ...row,
    ai_lines: Number(row.ai_lines || 0),
    total_lines: Number(row.total_lines || 0),
    is_ai_commit: row.is_ai_commit === "true"
  }));
}
function normalizeRecord(record) {
  return {
    ...record,
    ai_lines: Number(record.ai_lines || 0),
    total_lines: Number(record.total_lines || 0),
    is_ai_commit: Boolean(record.is_ai_commit)
  };
}
function parseRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
var CSV_HEADER;
var init_csv = __esm({
  "src/tracker/csv.js"() {
    init_paths();
    CSV_HEADER = "author,ai_lines,total_lines,is_ai_commit,commit_id,date,message";
  }
});

// src/tracker/lock.js
var lock_exports = {};
__export(lock_exports, {
  atomicWriteJson: () => atomicWriteJson,
  atomicWriteText: () => atomicWriteText,
  withFileLock: () => withFileLock
});
import fs2 from "node:fs/promises";
import path3 from "node:path";
async function withFileLock(lockFile, fn, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const started = Date.now();
  await fs2.mkdir(path3.dirname(lockFile), { recursive: true });
  while (true) {
    try {
      const handle = await fs2.open(lockFile, "wx");
      try {
        await handle.writeFile(`${process.pid}
${(/* @__PURE__ */ new Date()).toISOString()}
`);
      } finally {
        await handle.close();
      }
      try {
        return await fn();
      } finally {
        await fs2.rm(lockFile, { force: true });
      }
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - started >= timeoutMs) {
        const lockError = new Error(`Timed out waiting for lock: ${lockFile}`);
        await writeRecoveryLog(lockFile, lockError, {
          operation: options.operation ?? "acquire tracker lock",
          relatedPath: lockFile
        });
        throw lockError;
      }
      await sleep(pollMs);
    }
  }
}
async function atomicWriteJson(targetPath, data, options = {}) {
  await fs2.mkdir(path3.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${options.tempSuffix ?? `${process.pid}.${Date.now()}.tmp`}`;
  try {
    await fs2.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}
`, "utf8");
    await fs2.rename(tmpPath, targetPath);
  } catch (error) {
    await writeRecoveryLog(targetPath, error, {
      operation: options.operation ?? "write tracker JSON file",
      relatedPath: targetPath
    });
    throw error;
  }
}
async function atomicWriteText(targetPath, text, options = {}) {
  await fs2.mkdir(path3.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${options.tempSuffix ?? `${process.pid}.${Date.now()}.tmp`}`;
  try {
    await fs2.writeFile(tmpPath, text, "utf8");
    await fs2.rename(tmpPath, targetPath);
  } catch (error) {
    await writeRecoveryLog(targetPath, error, {
      operation: options.operation ?? "write tracker text file",
      relatedPath: targetPath
    });
    throw error;
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function writeRecoveryLog(filePath, error, { operation, relatedPath }) {
  const tracker = findTrackerDir(filePath);
  if (!tracker) {
    return;
  }
  const message = [
    `[${(/* @__PURE__ */ new Date()).toISOString()}] ${operation}`,
    `path: ${relatedPath}`,
    `error: ${error.code ? `${error.code}: ` : ""}${error.message}`,
    "recovery: release or delete the stale .lock/tmp file if no tracker process is using it, then retry the same opencode edit or git action.",
    ""
  ].join("\n");
  try {
    await fs2.mkdir(tracker, { recursive: true });
    await fs2.appendFile(path3.join(tracker, "errors.log"), message, "utf8");
  } catch {
  }
}
function findTrackerDir(filePath) {
  const parts = path3.resolve(filePath).split(path3.sep);
  const index = parts.lastIndexOf(".ai-tracking");
  if (index === -1) {
    return null;
  }
  return parts.slice(0, index + 1).join(path3.sep) || path3.sep;
}
var DEFAULT_TIMEOUT_MS, DEFAULT_POLL_MS;
var init_lock = __esm({
  "src/tracker/lock.js"() {
    DEFAULT_TIMEOUT_MS = 5e3;
    DEFAULT_POLL_MS = 50;
  }
});

// src/tracker/lineStore.js
var lineStore_exports = {};
__export(lineStore_exports, {
  appendPendingLines: () => appendPendingLines,
  consumeMatchedLines: () => consumeMatchedLines,
  loadPendingLines: () => loadPendingLines,
  savePendingLines: () => savePendingLines
});
import fs3 from "node:fs/promises";
async function loadPendingLines(repoRoot) {
  const file = pendingLinesPath(repoRoot);
  try {
    const raw = JSON.parse(await fs3.readFile(file, "utf8"));
    return migrateStore(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}
async function savePendingLines(repoRoot, data) {
  await atomicWriteJson(pendingLinesPath(repoRoot), normalizeStore(data), {
    operation: "write pending AI lines"
  });
}
async function appendPendingLines(repoRoot, filePath, lines, options = {}) {
  const countBlankLines = options.countBlankLines ?? false;
  const dedupeExisting = options.dedupeExisting ?? false;
  const replace = options.replace ?? false;
  return withFileLock(lockPath(repoRoot, "pending-lines"), async () => {
    const pending = await loadPendingLines(repoRoot);
    const base = replace ? [] : pending[filePath] ?? [];
    const existing = new Set(base.map((e) => e.content));
    const additions = [];
    for (const line of lines) {
      if (!countBlankLines && line.trim() === "") {
        continue;
      }
      if (dedupeExisting && existing.has(line)) {
        continue;
      }
      additions.push({ content: line, consumed: false });
    }
    if (replace && additions.length > 0) {
      pending[filePath] = additions;
    } else if (additions.length > 0) {
      pending[filePath] = [...base, ...additions];
    }
    if (replace && additions.length === 0 && pending[filePath]) {
      delete pending[filePath];
    }
    await savePendingLines(repoRoot, pending);
    return pending;
  }, { operation: "record pending AI lines" });
}
function consumeMatchedLines(pending, matched) {
  const next = normalizeStore(pending);
  for (const [filePath, lines] of Object.entries(matched ?? {})) {
    const entries = next[filePath] ?? [];
    const matchPool = [...lines];
    for (const entry of entries) {
      if (entry.consumed) {
        continue;
      }
      const index = matchPool.indexOf(entry.content);
      if (index === -1) {
        continue;
      }
      entry.consumed = true;
      matchPool.splice(index, 1);
    }
  }
  return next;
}
function normalizeStore(data) {
  const out = {};
  for (const [filePath, entries] of Object.entries(data ?? {})) {
    if (!Array.isArray(entries) || entries.length === 0) {
      continue;
    }
    const cleaned = entries.filter(isValidEntry);
    if (cleaned.length > 0) {
      out[filePath] = cleaned;
    }
  }
  return out;
}
function isValidEntry(entry) {
  return entry && typeof entry.content === "string";
}
function migrateStore(data) {
  const out = {};
  for (const [filePath, entries] of Object.entries(data ?? {})) {
    if (!Array.isArray(entries) || entries.length === 0) {
      continue;
    }
    out[filePath] = entries.map(
      (entry) => typeof entry === "string" ? { content: entry, consumed: false } : entry
    );
  }
  return out;
}
var init_lineStore = __esm({
  "src/tracker/lineStore.js"() {
    init_paths();
    init_lock();
  }
});

// src/tracker/logger.js
var logger_exports = {};
__export(logger_exports, {
  logDebug: () => logDebug,
  logError: () => logError,
  logInfo: () => logInfo,
  startTimer: () => startTimer
});
import fs4 from "node:fs/promises";
import path4 from "node:path";
async function logInfo(repoRoot, hook, message, extra = {}) {
  await writeLog(repoRoot, "INFO", hook, message, extra);
}
async function logError(repoRoot, hook, message, extra = {}) {
  await writeLog(repoRoot, "ERROR", hook, message, extra);
}
async function logDebug(repoRoot, hook, message, extra = {}) {
  await writeLog(repoRoot, "DEBUG", hook, message, extra);
}
function startTimer() {
  const start = performance.now();
  return {
    elapsedMs() {
      return Math.round(performance.now() - start);
    }
  };
}
async function writeLog(repoRoot, level, hook, message, extra) {
  try {
    const dir = trackerDir(repoRoot);
    const logFile = path4.join(dir, "plugin.log");
    await fs4.mkdir(dir, { recursive: true });
    await rotateIfNeeded(logFile, dir);
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const extraStr = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
    const line = `[${timestamp}] [${level}] [${hook}] ${message}${extraStr}
`;
    await fs4.appendFile(logFile, line, "utf8");
  } catch {
  }
}
async function rotateIfNeeded(logFile, dir) {
  let stat;
  try {
    stat = await fs4.stat(logFile);
  } catch {
    return;
  }
  if (stat.size < MAX_LOG_SIZE) {
    return;
  }
  for (let i = MAX_ARCHIVES - 1; i >= 1; i--) {
    const older = path4.join(dir, `plugin.log.${i}`);
    const newer = path4.join(dir, `plugin.log.${i - 1}`);
    const source = i === 1 ? logFile : newer;
    try {
      await fs4.rename(source, older);
    } catch {
    }
  }
  try {
    await fs4.rename(logFile, path4.join(dir, "plugin.log.1"));
  } catch {
  }
}
var MAX_LOG_SIZE, MAX_ARCHIVES;
var init_logger = __esm({
  "src/tracker/logger.js"() {
    init_paths();
    MAX_LOG_SIZE = 5 * 1024 * 1024;
    MAX_ARCHIVES = 3;
  }
});

// src/cli/commit-stats.js
init_csv();
import fs6 from "node:fs/promises";
import path5 from "node:path";
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";

// src/tracker/git.js
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var _gitPath = null;
async function findGit() {
  if (_gitPath) {
    return _gitPath;
  }
  if (process.platform !== "win32") {
    _gitPath = "git";
    return _gitPath;
  }
  const candidates = [];
  const envVars = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LocalAppData, process.env.ProgramW6432];
  for (const base of envVars) {
    if (!base) {
      continue;
    }
    candidates.push(join(base, "Git", "cmd", "git.exe"));
    candidates.push(join(base, "Git", "bin", "git.exe"));
  }
  candidates.push(join("C:", "Program Files", "Git", "cmd", "git.exe"));
  candidates.push(join("C:", "Program Files", "Git", "bin", "git.exe"));
  candidates.push(join("C:", "Program Files (x86)", "Git", "cmd", "git.exe"));
  for (const p of candidates) {
    try {
      await access(p);
      _gitPath = p;
      return _gitPath;
    } catch {
    }
  }
  _gitPath = "git";
  return _gitPath;
}
async function execGit(args, options = {}) {
  const gitBin = await findGit();
  return execFileAsync(gitBin, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024
  });
}
async function git(args, options = {}) {
  const { stdout } = await execGit(args, options);
  return stdout.trimEnd();
}
async function gitRaw(args, options = {}) {
  const { stdout } = await execGit(args, options);
  return stdout;
}
async function gitRepoRoot(cwd = process.cwd()) {
  return git(["rev-parse", "--show-toplevel"], { cwd });
}

// src/tracker/diff.js
function parseAddedLinesFromDiff(diffText) {
  const result = {};
  let currentFile = null;
  for (const rawLine of String(diffText || "").split(/\r?\n/)) {
    if (rawLine.startsWith("+++ ")) {
      const file = rawLine.slice(4).trim();
      currentFile = normalizeDiffPath(file);
      continue;
    }
    if (rawLine.startsWith("diff --git ")) {
      currentFile = null;
      continue;
    }
    if (!currentFile) {
      continue;
    }
    if (!rawLine.startsWith("+")) {
      continue;
    }
    if (rawLine.startsWith("+++")) {
      continue;
    }
    const line = rawLine.slice(1);
    if (!result[currentFile]) {
      result[currentFile] = [];
    }
    result[currentFile].push(line);
  }
  return result;
}
function parseRenamedFilesFromDiff(diffText) {
  const result = {};
  let renameFrom = null;
  let renameTo = null;
  for (const rawLine of String(diffText || "").split(/\r?\n/)) {
    if (rawLine.startsWith("diff --git ")) {
      addRename(result, renameFrom, renameTo);
      renameFrom = null;
      renameTo = null;
      continue;
    }
    if (rawLine.startsWith("rename from ")) {
      renameFrom = rawLine.slice("rename from ".length).trim();
      continue;
    }
    if (rawLine.startsWith("rename to ")) {
      renameTo = rawLine.slice("rename to ".length).trim();
    }
  }
  addRename(result, renameFrom, renameTo);
  return result;
}
function normalizeDiffPath(file) {
  if (file === "/dev/null") {
    return null;
  }
  if (file.startsWith("b/")) {
    return file.slice(2);
  }
  return file;
}
function addRename(result, renameFrom, renameTo) {
  if (!renameFrom || !renameTo) {
    return;
  }
  result[renameFrom] = renameTo;
}

// src/tracker/stats.js
function buildPendingCommit({
  pendingLines,
  addedLines: addedLines2,
  countBlankLines = false,
  renamedFiles = {},
  missingPendingFiles: missingPendingFiles2 = []
}) {
  let totalLines = 0;
  let aiLines = 0;
  const matchedLines = {};
  const pendingPools = buildPendingPools(pendingLines);
  const renameSourcesByTarget = buildRenameSourcesByTarget(renamedFiles);
  const missingPending = new Set(missingPendingFiles2);
  for (const [filePath, lines] of Object.entries(addedLines2 ?? {})) {
    const counted = countBlankLines ? lines : lines.filter((l) => l.trim() !== "");
    totalLines += counted.length;
    for (const line of counted) {
      const sourcePath = findMatchSource({
        pendingPools,
        filePath,
        line,
        renameSources: renameSourcesByTarget[filePath] ?? [],
        missingPending
      });
      if (!sourcePath) {
        continue;
      }
      aiLines += 1;
      if (!matchedLines[sourcePath]) {
        matchedLines[sourcePath] = [];
      }
      matchedLines[sourcePath].push(line);
    }
  }
  return {
    ai_lines: aiLines,
    total_lines: totalLines,
    matched_lines: matchedLines
  };
}
function buildPendingPools(pendingLines) {
  const pools = {};
  for (const [filePath, entries] of Object.entries(pendingLines ?? {})) {
    pools[filePath] = entries.filter((e) => !e.consumed).map((e) => e.content);
  }
  return pools;
}
function buildRenameSourcesByTarget(renamedFiles) {
  const sourcesByTarget = {};
  for (const [source, target] of Object.entries(renamedFiles ?? {})) {
    if (!sourcesByTarget[target]) {
      sourcesByTarget[target] = [];
    }
    sourcesByTarget[target].push(source);
  }
  return sourcesByTarget;
}
function findMatchSource({ pendingPools, filePath, line, renameSources, missingPending }) {
  if (consumeFromPool(pendingPools[filePath], line)) {
    return filePath;
  }
  for (const source of renameSources) {
    if (consumeFromPool(pendingPools[source], line)) {
      return source;
    }
  }
  for (const source of missingPending) {
    if (source === filePath || renameSources.includes(source)) {
      continue;
    }
    if (consumeFromPool(pendingPools[source], line)) {
      return source;
    }
  }
  return null;
}
function consumeFromPool(pool, line) {
  if (!pool) {
    return false;
  }
  const index = pool.indexOf(line);
  if (index === -1) {
    return false;
  }
  pool.splice(index, 1);
  return true;
}

// src/cli/commit-stats.js
init_lineStore();
init_lock();
init_paths();

// src/tracker/shared.js
init_paths();
import fs5 from "node:fs/promises";
function addedLines(before, after) {
  const bLines = String(before).split(/\r?\n/);
  const aLines = String(after).split(/\r?\n/);
  const diff = myersDiff(bLines, aLines);
  return diff.filter((op) => op.type === "insert").map((op) => op.line);
}
function myersDiff(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) {
    return [];
  }
  const v = new Int32Array(2 * max + 1).fill(max + 1);
  const trace = [];
  const offset = max;
  v[offset + 1] = 0;
  let done = false;
  for (let d = 0; d <= max && !done; d++) {
    trace.push(Int32Array.from(v));
    for (let k = -d; k <= d; k += 2) {
      let x2;
      if (k === -d || k !== d && v[offset + k - 1] < v[offset + k + 1]) {
        x2 = v[offset + k + 1];
      } else {
        x2 = v[offset + k - 1] + 1;
      }
      let y2 = x2 - k;
      while (x2 < n && y2 < m && a[x2] === b[y2]) {
        x2++;
        y2++;
      }
      v[offset + k] = x2;
      if (x2 >= n && y2 >= m) {
        done = true;
        break;
      }
    }
  }
  const ops = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vPrev = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || k !== d && vPrev[offset + k - 1] < vPrev[offset + k + 1]) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vPrev[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ type: "keep", line: a[x] });
    }
    if (d > 0) {
      if (x === prevX) {
        y--;
        ops.push({ type: "insert", line: b[y] });
      } else {
        x--;
        ops.push({ type: "delete", line: a[x] });
      }
    }
  }
  ops.reverse();
  return ops;
}
async function loadConfig(repoRoot) {
  try {
    return JSON.parse(await fs5.readFile(configPath(repoRoot), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      const { logError: logError2 } = await Promise.resolve().then(() => (init_logger(), logger_exports));
      await logError2(repoRoot, "loadConfig", "failed to read config, using defaults", { error: error.message });
    }
    return { enabled: true, count_blank_lines: false, tracking_commit_suffix: "[ai-tracking]", auto_tracking_commit: true };
  }
}
var DEFAULT_IGNORE = [
  ".ai-tracking/**",
  ".git/**",
  "node_modules/**",
  "dist/**",
  "build/**"
];
function shouldIgnore(filePath, patterns = DEFAULT_IGNORE) {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) {
      return filePath.startsWith(pattern.slice(0, -3));
    }
    return filePath === pattern;
  });
}
async function safeRead(filePath) {
  try {
    return await fs5.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

// src/cli/commit-stats.js
init_logger();
var execFileAsync2 = promisify2(execFile2);
async function runCommitStats(mode, options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const gitImpl = options.git ?? git;
  const gitRawImpl = options.gitRaw ?? gitRaw;
  const repoRoot = options.repoRoot ?? await gitRepoRoot(cwd);
  if (env.AI_CODE_TRACKER_SKIP === "1") {
    await logInfo(repoRoot, "commit-stats", "skipped: skip-env", { mode });
    return { skipped: "skip-env" };
  }
  const config = await loadConfig(repoRoot);
  if (!config.enabled) {
    await logInfo(repoRoot, "commit-stats", "skipped: disabled", { mode });
    return { skipped: "disabled" };
  }
  await logInfo(repoRoot, `commit-stats.${mode}`, "enter");
  if (mode === "prune") {
    return runPrune({ repoRoot, gitImpl });
  }
  await pruneCsvRecordsIfPossible(repoRoot, gitImpl);
  if (mode === "pre-commit") {
    return runPreCommit({ repoRoot, gitRawImpl, env, processTreeReader: options.processTreeReader });
  }
  if (mode === "post-commit") {
    return runPostCommit({ repoRoot, gitImpl, gitRawImpl, env });
  }
  if (mode === "pre-push") {
    return runPrePush({ repoRoot, now: options.now });
  }
  throw new Error(`Unknown commit-stats mode: ${mode}`);
}
async function runPrune({ repoRoot, gitImpl }) {
  const timer = startTimer();
  const result = await pruneCsvRecordsIfPossible(repoRoot, gitImpl);
  await logInfo(repoRoot, "prune", "complete", { ...result, durationMs: timer.elapsedMs() });
  return { pruned: true, ...result };
}
async function runPrePush({ repoRoot, now = /* @__PURE__ */ new Date() }) {
  const timer = startTimer();
  const files = [pendingLinesPath(repoRoot), pendingCommitPath(repoRoot), trackingMessagePath(repoRoot)];
  const existing = [];
  for (const file of files) {
    try {
      await fs6.access(file);
      existing.push(file);
    } catch {
    }
  }
  if (existing.length === 0) {
    await logInfo(repoRoot, "pre-push", "skipped: no pending files", { durationMs: timer.elapsedMs() });
    return { skipped: "no-pending-files" };
  }
  const target = path5.join(archiveDir(repoRoot), archiveStamp(now));
  await fs6.mkdir(target, { recursive: true });
  for (const file of existing) {
    await fs6.copyFile(file, path5.join(target, path5.basename(file)));
    await fs6.rm(file, { force: true });
  }
  await logInfo(repoRoot, "pre-push", "archived pending files", { files: existing.map((f) => path5.basename(f)), archive: target, durationMs: timer.elapsedMs() });
  return { archived: existing.map((file) => path5.basename(file)), archive: target };
}
async function runPreCommit({ repoRoot, gitRawImpl, env, processTreeReader }) {
  const timer = startTimer();
  const diff = await gitRawImpl(["diff", "--cached", "--unified=0", "--find-renames"], { cwd: repoRoot });
  const addedLines2 = removeTrackingFiles(parseAddedLinesFromDiff(diff));
  const renamedFiles = parseRenamedFilesFromDiff(diff);
  const pendingLines = await loadPendingLines(repoRoot);
  const config = await loadConfig(repoRoot);
  const pendingCommit = buildPendingCommit({
    pendingLines,
    addedLines: addedLines2,
    countBlankLines: config.count_blank_lines,
    renamedFiles,
    missingPendingFiles: await missingPendingFiles(repoRoot, pendingLines)
  });
  const withCommitSource = {
    ...pendingCommit,
    is_ai_commit: await isAiCreatedCommit(env, { processTreeReader })
  };
  await atomicWriteJson(pendingCommitPath(repoRoot), withCommitSource, {
    operation: "write pending commit tracking stats"
  });
  const stagedFiles = Object.keys(addedLines2);
  await logInfo(repoRoot, "pre-commit", "complete", {
    stagedFiles: stagedFiles.length,
    totalAddedLines: pendingCommit.total_lines,
    aiLines: pendingCommit.ai_lines,
    isAiCommit: withCommitSource.is_ai_commit,
    durationMs: timer.elapsedMs()
  });
  return { written: withCommitSource };
}
async function missingPendingFiles(repoRoot, pendingLines) {
  const missing = [];
  for (const filePath of Object.keys(pendingLines ?? {})) {
    try {
      await fs6.access(path5.join(repoRoot, filePath));
    } catch {
      missing.push(filePath);
    }
  }
  return missing;
}
async function runPostCommit({ repoRoot, gitImpl, gitRawImpl, env }) {
  const timer = startTimer();
  if (Number(env.AI_CODE_TRACKER_DEPTH || "0") > 0) {
    throw new Error("Refusing recursive ai-code-tracker post-commit execution");
  }
  const fullMessage = await gitRawImpl(["log", "-1", "--pretty=%B"], { cwd: repoRoot });
  const subject = fullMessage.split(/\r?\n/)[0] || "";
  const config = await loadConfig(repoRoot);
  const suffix = config.tracking_commit_suffix || "[ai-tracking]";
  if (fullMessage.includes(suffix)) {
    await logInfo(repoRoot, "post-commit", "skipped: tracking commit", { subject, durationMs: timer.elapsedMs() });
    return { skipped: "tracking-commit" };
  }
  const parentCount = await gitImpl(["rev-parse", "--verify", "HEAD^2"], { cwd: repoRoot }).then(() => 2).catch(() => 1);
  if (parentCount > 1) {
    await logInfo(repoRoot, "post-commit", "skipped: merge commit", { subject, parents: parentCount, durationMs: timer.elapsedMs() });
    return { skipped: "merge-commit" };
  }
  const pendingPath = pendingCommitPath(repoRoot);
  let pendingCommit;
  try {
    pendingCommit = JSON.parse(await fs6.readFile(pendingPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      await logInfo(repoRoot, "post-commit", "skipped: no pending commit", { durationMs: timer.elapsedMs() });
      return { skipped: "no-pending-commit" };
    }
    throw error;
  }
  await logInfo(repoRoot, "post-commit", "processing commit", { subject, aiLines: pendingCommit.ai_lines, totalLines: pendingCommit.total_lines });
  const commitId = await gitImpl(["rev-parse", "HEAD"], { cwd: repoRoot });
  const author = await gitImpl(["log", "-1", "--pretty=%an"], { cwd: repoRoot });
  const date = formatCommitDate(await gitImpl(["log", "-1", "--pretty=%ad", "--date=iso-strict"], { cwd: repoRoot }));
  const messageSubject = subject;
  let aiLines = pendingCommit.ai_lines;
  let totalLines = pendingCommit.total_lines;
  if (aiLines === 0 && totalLines > 0) {
    const source = await findCherryPickSource(repoRoot, fullMessage);
    if (source) {
      const sourceRecord = await findCsvRecord(repoRoot, source);
      if (sourceRecord) {
        aiLines = sourceRecord.ai_lines;
        totalLines = sourceRecord.total_lines;
        await logInfo(repoRoot, "post-commit", "cherry-pick: copied AI lines from source", { source, aiLines, totalLines });
      }
    }
  }
  const csvPath = authorCsvPath(repoRoot, author);
  const autoTracking = config.auto_tracking_commit !== false;
  const csvRelPath = path5.relative(repoRoot, csvPath);
  const parentBlob = await gitImpl(["rev-parse", `HEAD~1:${csvRelPath}`], { cwd: repoRoot }).catch(() => null);
  const currentBlob = await gitImpl(["rev-parse", `HEAD:${csvRelPath}`], { cwd: repoRoot }).catch(() => null);
  const csvChangedInCommit = parentBlob !== null && parentBlob !== currentBlob;
  const record = {
    author,
    ai_lines: aiLines,
    total_lines: totalLines,
    is_ai_commit: pendingCommit.is_ai_commit === true,
    commit_id: commitId,
    date,
    message: messageSubject
  };
  if (autoTracking) {
    if (csvChangedInCommit) {
      await logInfo(repoRoot, "post-commit", "CSV already in commit, skipped tracking", { commitId: commitId.slice(0, 7) });
    } else {
      await appendRecord(csvPath, record);
      await atomicWriteText(trackingMessagePath(repoRoot), trackingMessage(fullMessage, suffix), {
        operation: "write tracking commit message"
      });
      await stageTrackingFiles({ repoRoot, gitImpl, csvPath });
      await assertOnlyTrackingStaged(repoRoot, gitRawImpl);
      await gitImpl(["commit", "-F", ".ai-tracking/tracking-message.txt"], {
        cwd: repoRoot,
        env: { ...process.env, AI_CODE_TRACKER_SKIP: "1", AI_CODE_TRACKER_DEPTH: "1" }
      });
    }
    await fs6.rm(pendingPath, { force: true });
    await fs6.rm(trackingMessagePath(repoRoot), { force: true });
  } else {
    if (!csvChangedInCommit) {
      await appendRecord(csvPath, record);
      await logInfo(repoRoot, "post-commit", "auto_tracking_commit disabled: CSV record appended", { commitId: commitId.slice(0, 7) });
    } else {
      await logInfo(repoRoot, "post-commit", "auto_tracking_commit disabled: CSV already in commit, skipped", { commitId: commitId.slice(0, 7) });
    }
    await fs6.rm(pendingPath, { force: true });
  }
  const pendingLines = await loadPendingLines(repoRoot);
  await savePendingLines(repoRoot, consumeMatchedLines(pendingLines, pendingCommit.matched_lines));
  await cleanOriginalSnapshots(repoRoot);
  await logInfo(repoRoot, "post-commit", "complete", { commitId: commitId.slice(0, 7), author, aiLines: pendingCommit.ai_lines, totalLines: pendingCommit.total_lines, autoTracking, durationMs: timer.elapsedMs() });
  return { committed: true };
}
async function stageTrackingFiles({ repoRoot, gitImpl, csvPath }) {
  await gitImpl(["add", csvPath], { cwd: repoRoot });
  await gitImpl([
    "rm",
    "--cached",
    "-f",
    "--ignore-unmatch",
    pendingLinesPath(repoRoot),
    pendingCommitPath(repoRoot),
    trackingMessagePath(repoRoot)
  ], { cwd: repoRoot });
}
async function assertOnlyTrackingStaged(repoRoot, gitRawImpl) {
  const names = (await gitRawImpl(["diff", "--cached", "--name-only"], { cwd: repoRoot })).split(/\r?\n/).filter(Boolean);
  const invalid = names.filter((name) => !name.startsWith(".ai-tracking/"));
  if (invalid.length > 0) {
    throw new Error(`Refusing tracking commit with non-tracking staged files: ${invalid.join(", ")}`);
  }
}
function removeTrackingFiles(addedLines2) {
  return Object.fromEntries(
    Object.entries(addedLines2).filter(([filePath]) => !filePath.startsWith(".ai-tracking/"))
  );
}
function trackingMessage(fullMessage, suffix = "[ai-tracking]") {
  const trimmed = String(fullMessage || "").replace(/\s+$/u, "");
  const lines = trimmed.split(/\r?\n/);
  const subject = lines.shift() || "AI code tracking";
  const body = lines.join("\n").trimEnd();
  if (body) {
    return `${subject}
${body}

${suffix}
`;
  }
  return `${subject}

${suffix}
`;
}
function formatCommitDate(value) {
  return String(value || "").replace("T", " ").replace(/([+-]\d{2}:\d{2}|Z)$/u, "");
}
function archiveStamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/u, "Z").replace(/[:]/g, "");
}
async function isAiCreatedCommit(env, options = {}) {
  if (env.AI_CODE_TRACKER_PROCESS_TREE) {
    return includesAiAgent(env.AI_CODE_TRACKER_PROCESS_TREE);
  }
  const processTree = options.processTreeReader ? await options.processTreeReader() : await readProcessTree();
  return includesAiAgent(processTree);
}
async function readProcessTree() {
  if (process.platform === "win32") {
    return readWindowsProcessTree();
  }
  return readPosixProcessTree();
}
async function readPosixProcessTree() {
  const commands = [];
  let pid = process.ppid;
  const seen = /* @__PURE__ */ new Set();
  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid);
    const stat = await readProcStat(pid) ?? await readPsStat(pid);
    if (!stat) {
      break;
    }
    commands.push(stat.command);
    pid = stat.parentPid;
  }
  return commands.join("\n");
}
async function readWindowsProcessTree(startPid = process.ppid, execFileImpl = execFileAsync2) {
  const script = `
$pidToRead = ${Number(startPid) || 0}
$items = @()
for ($i = 0; $i -lt 32 -and $pidToRead -gt 0; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$pidToRead"
  if ($null -eq $p) { break }
  $items += (($p.Name + " " + $p.CommandLine).Trim())
  $pidToRead = [int]$p.ParentProcessId
}
$items -join [Environment]::NewLine
`;
  try {
    const { stdout } = await execFileImpl("powershell.exe", ["-NoProfile", "-Command", script], {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    return stdout;
  } catch {
    return "";
  }
}
async function readProcStat(pid) {
  try {
    const stat = await fs6.readFile(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    const openParen = stat.indexOf("(");
    if (openParen === -1 || closeParen === -1) {
      return null;
    }
    const command = stat.slice(openParen + 1, closeParen);
    const rest = stat.slice(closeParen + 2).split(" ");
    return { command, parentPid: Number(rest[1] || 0) };
  } catch {
    return null;
  }
}
async function readPsStat(pid, execFileImpl = execFileAsync2) {
  try {
    const { stdout } = await execFileImpl("ps", ["-o", "ppid=", "-o", "comm=", "-p", String(pid)], {
      maxBuffer: 1024 * 1024
    });
    const line = stdout.trim();
    const match = line.match(/^(\d+)\s+(.+)$/u);
    if (!match) {
      return null;
    }
    return { parentPid: Number(match[1]), command: match[2] };
  } catch {
    return null;
  }
}
function includesAiAgent(processTree) {
  return String(processTree || "").split(/\r?\n/).some(
    (command) => /(^|[\\/\s])(?:opencode|code-?agent|claude)(?:\.exe)?($|[\\/\s])/i.test(command)
  );
}
async function pruneCsvRecordsIfPossible(repoRoot, gitImpl) {
  try {
    await gitImpl(["rev-parse", "--verify", "HEAD"], { cwd: repoRoot });
    let author;
    try {
      author = await gitImpl(["config", "user.name"], { cwd: repoRoot });
    } catch {
      author = null;
    }
    await pruneStaleRecords(repoRoot, async (commitId) => {
      try {
        const branches = await gitImpl(["branch", "--all", "--contains", commitId], { cwd: repoRoot });
        return branches.trim().length > 0;
      } catch {
        return false;
      }
    }, author || void 0);
  } catch {
  }
}
async function findCherryPickSource(repoRoot, fullMessage) {
  const match = fullMessage.match(/\(cherry picked from commit ([0-9a-f]+)\)/);
  return match?.[1] ?? null;
}
async function findCsvRecord(repoRoot, commitId) {
  try {
    const { readRecords: readRecords2 } = await Promise.resolve().then(() => (init_csv(), csv_exports));
    const records = await readRecords2(repoRoot);
    return records.find((r) => r.commit_id === commitId || r.commit_id.startsWith(commitId)) ?? null;
  } catch {
    return null;
  }
}
async function cleanOriginalSnapshots(repoRoot) {
  const dir = snapshotDir(repoRoot);
  let entries;
  try {
    entries = await fs6.readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith("original-") && entry.endsWith(".json")) {
      await fs6.rm(path5.join(dir, entry), { force: true });
    }
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  runCommitStats(process.argv[2]).catch((error) => {
    console.error(`[ai-code-tracker] ${error.message}`);
    process.exitCode = 1;
  });
}

// src/cli/ai-code-stats.js
init_csv();
init_logger();
async function runAiCodeStats(args = process.argv.slice(2), options = {}) {
  const timer = startTimer();
  const repoRoot = options.repoRoot ?? await gitRepoRoot(options.cwd ?? process.cwd());
  const gitImpl = options.git ?? git;
  await logInfo(repoRoot, "ai-code-stats", "enter");
  await pruneCsvRecordsIfPossible2(repoRoot, gitImpl);
  const filters = parseArgs(args);
  let records = await readRecords(repoRoot);
  if (filters.author) {
    records = records.filter((record) => record.author === filters.author);
  }
  if (filters.since) {
    records = records.filter((record) => record.date >= filters.since);
  }
  const totalLines = sum(records, "total_lines");
  const aiLines = sum(records, "ai_lines");
  const ratio = totalLines === 0 ? 0 : aiLines / totalLines * 100;
  const aiCodeCommits = records.filter((record) => record.ai_lines > 0).length;
  const aiGeneratedCommits = records.filter((record) => record.is_ai_commit).length;
  const recent = [...records].sort((a, b) => `${b.date}:${b.commit_id}`.localeCompare(`${a.date}:${a.commit_id}`)).slice(0, filters.last);
  const output = formatSummary({
    totalLines,
    aiLines,
    ratio,
    aiCodeCommits,
    aiGeneratedCommits,
    trackedCommits: records.length,
    recent
  });
  await logInfo(repoRoot, "ai-code-stats", "complete", {
    trackedCommits: records.length,
    totalLines,
    aiLines,
    ratio: `${ratio.toFixed(1)}%`,
    durationMs: timer.elapsedMs()
  });
  if (!options.silent) {
    console.log(output);
  }
  return { totalLines, aiLines, ratio, aiCodeCommits, aiGeneratedCommits, trackedCommits: records.length, recent, output };
}
function parseArgs(args) {
  const filters = { last: 10 };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--author") {
      filters.author = args[++i];
    } else if (arg === "--since") {
      filters.since = args[++i];
    } else if (arg === "--last") {
      filters.last = Number(args[++i] || 10);
    }
  }
  return filters;
}
function formatSummary({ totalLines, aiLines, ratio, aiCodeCommits, aiGeneratedCommits, trackedCommits, recent }) {
  const lines = [
    "AI Code Stats",
    "",
    `Total added lines: ${totalLines}`,
    `AI added lines: ${aiLines}`,
    `AI ratio: ${ratio.toFixed(1)}%`,
    `AI-code commits: ${aiCodeCommits}`,
    `AI-generated commits: ${aiGeneratedCommits}`,
    `Tracked commits: ${trackedCommits}`
  ];
  if (recent.length > 0) {
    lines.push("", "Recent tracked commits:");
    for (const record of recent) {
      lines.push(`${record.date}  ${record.author}  ${record.ai_lines}/${record.total_lines}  ${record.commit_id.slice(0, 7)}  ${record.message}`);
    }
  }
  return lines.join("\n");
}
function sum(records, key) {
  return records.reduce((total, record) => total + Number(record[key] || 0), 0);
}
async function pruneCsvRecordsIfPossible2(repoRoot, gitImpl) {
  try {
    await gitImpl(["rev-parse", "--verify", "HEAD"], { cwd: repoRoot });
    await pruneStaleRecords(repoRoot, async (commitId) => {
      try {
        await gitImpl(["merge-base", "--is-ancestor", commitId, "HEAD"], { cwd: repoRoot });
        return true;
      } catch {
        return false;
      }
    });
  } catch {
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  runAiCodeStats().catch((error) => {
    console.error(`[ai-code-tracker] ${error.message}`);
    process.exitCode = 1;
  });
}

// src/tracker/updater.js
init_paths();
import fs7 from "node:fs/promises";
import path6 from "node:path";
import { execFileSync } from "node:child_process";
init_lock();
init_logger();
var SKILL_DIR = ".opencode/skills/ai-code-tracker";
var CLAUDE_SKILL_DIR = ".claude/skills/ai-code-tracker";
var BACKUP_DIR = ".ai-tracking/backup-pre-update";
var CLAUDE_BACKUP_DIR = ".ai-tracking/backup-pre-update-claude";
var AVAILABLE_UPDATE_FILE = ".ai-tracking/available-update.json";
var GITHUB_API = "https://api.github.com/repos/yooocen/git-code-tracker/releases/latest";
function parseTag(tag) {
  return (tag || "").replace(/^v/, "");
}
async function checkVersion(repoRoot) {
  const config = await loadConfig(repoRoot);
  if (!config.check_updates) {
    return null;
  }
  const intervalHours = config.update_check_interval_hours ?? 24;
  const lastCheck = config.last_update_check;
  if (lastCheck) {
    const hoursSinceLastCheck = (Date.now() - new Date(lastCheck).getTime()) / 36e5;
    if (hoursSinceLastCheck < intervalHours) {
      const cached = await readAvailableUpdate(repoRoot);
      if (cached) {
        return cached;
      }
    }
  }
  const localVersion = config.installed_version || "0.0.0";
  let data;
  try {
    const res = await fetch(GITHUB_API);
    if (!res.ok) {
      await logInfo(repoRoot, "updater.checkVersion", `GitHub API returned ${res.status}`);
      return null;
    }
    data = await res.json();
  } catch (error) {
    await logInfo(repoRoot, "updater.checkVersion", `fetch failed: ${error.message}`);
    return null;
  }
  const remoteVersion = parseTag(data.tag_name);
  if (remoteVersion === localVersion) {
    await logInfo(repoRoot, "updater.checkVersion", "already up to date", { version: localVersion });
    await clearAvailableUpdate(repoRoot);
    return null;
  }
  const updateInfo = {
    local_version: localVersion,
    remote_version: remoteVersion,
    tag_name: data.tag_name,
    release_url: data.html_url,
    tarball_url: data.tarball_url,
    body: (data.body || "").slice(0, 500),
    checked_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  await saveAvailableUpdate(repoRoot, updateInfo);
  await logInfo(repoRoot, "updater.checkVersion", "update available", { local: localVersion, remote: remoteVersion });
  config.last_update_check = (/* @__PURE__ */ new Date()).toISOString();
  await atomicWriteJson(configPath(repoRoot), config);
  return updateInfo;
}
async function readAvailableUpdate(repoRoot) {
  try {
    const content = await fs7.readFile(path6.join(repoRoot, AVAILABLE_UPDATE_FILE), "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}
async function saveAvailableUpdate(repoRoot, data) {
  const filePath = path6.join(repoRoot, AVAILABLE_UPDATE_FILE);
  await fs7.mkdir(path6.dirname(filePath), { recursive: true });
  await fs7.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}
async function clearAvailableUpdate(repoRoot) {
  try {
    await fs7.rm(path6.join(repoRoot, AVAILABLE_UPDATE_FILE), { force: true });
  } catch {
  }
}
async function backup(repoRoot) {
  const timer = startTimer();
  const src = path6.join(repoRoot, SKILL_DIR);
  const dest = path6.join(repoRoot, BACKUP_DIR);
  await fs7.rm(dest, { recursive: true, force: true });
  await fs7.cp(src, dest, { recursive: true, force: true });
  const claudeSrc = path6.join(repoRoot, CLAUDE_SKILL_DIR);
  const claudeDest = path6.join(repoRoot, CLAUDE_BACKUP_DIR);
  await fs7.rm(claudeDest, { recursive: true, force: true });
  try {
    await fs7.cp(claudeSrc, claudeDest, { recursive: true, force: true });
  } catch {
  }
  await logInfo(repoRoot, "updater.backup", "backup created", { durationMs: timer.elapsedMs() });
}
async function applyReleaseFiles(repoRoot, extractDir) {
  const skillDest = path6.join(repoRoot, SKILL_DIR);
  const srcSkillDir = path6.join(extractDir, ".opencode", "skills", "ai-code-tracker");
  const scriptsSrc = path6.join(srcSkillDir, "scripts");
  const scriptsDest = path6.join(skillDest, "scripts");
  const scriptsToCopy = ["ai-update.js", "install.js", "commit-stats.js", "claude-code-hook.js", "ai-code-stats.js", "opencode-plugin.js", "bundle.js"];
  for (const script of scriptsToCopy) {
    try {
      await fs7.copyFile(path6.join(scriptsSrc, script), path6.join(scriptsDest, script));
    } catch (error) {
      await logInfo(repoRoot, "updater.upgrade", `script ${script} not found in release`, { error: error.message });
    }
  }
  const commandsSrc = path6.join(srcSkillDir, "commands");
  const commandsDest = path6.join(skillDest, "commands");
  await fs7.cp(commandsSrc, commandsDest, { recursive: true, force: true });
  try {
    await fs7.copyFile(path6.join(srcSkillDir, "SKILL.md"), path6.join(skillDest, "SKILL.md"));
  } catch {
  }
  await fs7.rm(path6.join(skillDest, "lib"), { recursive: true, force: true });
  const claudeSkillDest = path6.join(repoRoot, CLAUDE_SKILL_DIR);
  try {
    await fs7.stat(claudeSkillDest);
    await fs7.rm(path6.join(claudeSkillDest, "lib"), { recursive: true, force: true });
    await fs7.cp(skillDest, claudeSkillDest, { recursive: true, force: true });
    await logInfo(repoRoot, "updater.upgrade", "synced .claude skill dir");
  } catch {
  }
}
async function downloadAndUpgrade(repoRoot, updateInfo) {
  const timer = startTimer();
  await logInfo(repoRoot, "updater.upgrade", "starting upgrade", { version: updateInfo.remote_version });
  await backup(repoRoot);
  const tmpDir = path6.join(repoRoot, ".ai-tracking", ".update-tmp");
  await fs7.mkdir(tmpDir, { recursive: true });
  const tarballPath = path6.join(tmpDir, "release.tar.gz");
  try {
    await logInfo(repoRoot, "updater.upgrade", "downloading release", { url: updateInfo.tarball_url });
    const res = await fetch(updateInfo.tarball_url);
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status}`);
    }
    const buffer = await res.arrayBuffer();
    await fs7.writeFile(tarballPath, Buffer.from(buffer));
    await logInfo(repoRoot, "updater.upgrade", "extracting release");
    const extractDir = path6.join(tmpDir, "extracted");
    await fs7.mkdir(extractDir, { recursive: true });
    execFileSync("tar", ["xzf", tarballPath, "--strip-components=1", "-C", extractDir], { cwd: tmpDir });
    const skillDest = path6.join(repoRoot, SKILL_DIR);
    await applyReleaseFiles(repoRoot, extractDir);
    await logInfo(repoRoot, "updater.upgrade", "running install.js");
    const { execFile: execFile4 } = await import("node:child_process");
    const { promisify: promisify4 } = await import("node:util");
    const execFileAsync4 = promisify4(execFile4);
    await execFileAsync4("node", ["--experimental-vm-modules", path6.join(skillDest, "scripts", "install.js")], { cwd: repoRoot });
    const cfg = JSON.parse(await fs7.readFile(configPath(repoRoot), "utf8"));
    cfg.installed_version = updateInfo.remote_version;
    cfg.last_update_check = (/* @__PURE__ */ new Date()).toISOString();
    const { atomicWriteJson: atomicWriteJson2 } = await Promise.resolve().then(() => (init_lock(), lock_exports));
    await atomicWriteJson2(configPath(repoRoot), cfg);
    await fs7.rm(tmpDir, { recursive: true, force: true });
    await clearAvailableUpdate(repoRoot);
    await logInfo(repoRoot, "updater.upgrade", "upgrade complete", { version: updateInfo.remote_version, durationMs: timer.elapsedMs() });
    return { ok: true, version: updateInfo.remote_version };
  } catch (error) {
    await logInfo(repoRoot, "updater.upgrade", `upgrade failed: ${error.message}`);
    try {
      await rollback(repoRoot);
    } catch (rollbackError) {
      await logInfo(repoRoot, "updater.rollback", `rollback failed: ${rollbackError.message}`);
    }
    await fs7.rm(tmpDir, { recursive: true, force: true }).catch(() => {
    });
    throw error;
  }
}
async function rollback(repoRoot) {
  const timer = startTimer();
  const backupSrc = path6.join(repoRoot, BACKUP_DIR);
  const dest = path6.join(repoRoot, SKILL_DIR);
  const stat = await fs7.stat(backupSrc).catch(() => null);
  if (!stat) {
    await logInfo(repoRoot, "updater.rollback", "no backup found");
    throw new Error("No backup available for rollback");
  }
  await fs7.rm(dest, { recursive: true, force: true });
  await fs7.cp(backupSrc, dest, { recursive: true, force: true });
  await fs7.rm(backupSrc, { recursive: true, force: true });
  const claudeBackupSrc = path6.join(repoRoot, CLAUDE_BACKUP_DIR);
  const claudeStat = await fs7.stat(claudeBackupSrc).catch(() => null);
  if (claudeStat) {
    const claudeDest = path6.join(repoRoot, CLAUDE_SKILL_DIR);
    await fs7.rm(claudeDest, { recursive: true, force: true });
    await fs7.cp(claudeBackupSrc, claudeDest, { recursive: true, force: true });
    await fs7.rm(claudeBackupSrc, { recursive: true, force: true });
  }
  await logInfo(repoRoot, "updater.rollback", "rollback complete", { durationMs: timer.elapsedMs() });
}

// src/cli/ai-update.js
async function runAiCodeUpdate(args = process.argv.slice(2)) {
  const cwd = process.cwd();
  const repoRoot = await gitRepoRoot(cwd);
  const mode = args.includes("--check") ? "check" : "upgrade";
  if (mode === "check") {
    const updateInfo2 = await checkVersion(repoRoot);
    if (!updateInfo2) {
      console.log("[ai-code-tracker] \u5F53\u524D\u5DF2\u662F\u6700\u65B0\u7248\u672C");
      return;
    }
    console.log(`[ai-code-tracker] \u53D1\u73B0\u65B0\u7248\u672C: ${updateInfo2.local_version} \u2192 ${updateInfo2.remote_version}`);
    console.log(`  \u53D1\u5E03\u8BF4\u660E: ${updateInfo2.release_url}`);
    if (updateInfo2.body) {
      console.log(`  \u66F4\u65B0\u8BF4\u660E: ${updateInfo2.body}`);
    }
    return;
  }
  const updateInfo = await readAvailableUpdate(repoRoot) || await checkVersion(repoRoot);
  if (!updateInfo) {
    console.log("[ai-code-tracker] \u5F53\u524D\u5DF2\u662F\u6700\u65B0\u7248\u672C");
    return;
  }
  console.log(`[ai-code-tracker] \u53D1\u73B0\u65B0\u7248\u672C: ${updateInfo.local_version} \u2192 ${updateInfo.remote_version}`);
  if (!args.includes("--yes")) {
    console.log("[ai-code-tracker] \u8FD0\u884C 'ai-update --yes' \u786E\u8BA4\u5347\u7EA7");
    return;
  }
  console.log(`[ai-code-tracker] \u5F00\u59CB\u5347\u7EA7: ${updateInfo.local_version} \u2192 ${updateInfo.remote_version}`);
  try {
    const result = await downloadAndUpgrade(repoRoot, updateInfo);
    console.log(`[ai-code-tracker] \u5347\u7EA7\u5B8C\u6210: ${result.version}`);
    console.log("[ai-code-tracker] \u8BF7\u91CD\u542F\u5F53\u524D opencode \u4F1A\u8BDD\u4F7F\u5347\u7EA7\u751F\u6548");
  } catch (error) {
    console.error(`[ai-code-tracker] \u5347\u7EA7\u5931\u8D25: ${error.message}`);
    process.exitCode = 1;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  runAiCodeUpdate().catch((error) => {
    console.error(`[ai-code-tracker] ${error.message}`);
    process.exitCode = 1;
  });
}

// src/cli/install.js
import { execFile as execFile3 } from "node:child_process";
import { promisify as promisify3 } from "node:util";
import fs8 from "node:fs/promises";
import fsSync from "node:fs";
import path7 from "node:path";
import { fileURLToPath } from "node:url";
init_paths();
init_lock();
init_logger();
var execFileAsync3 = promisify3(execFile3);
var BEGIN = "# ai-code-tracker begin";
var END = "# ai-code-tracker end";
function moduleDirFromFileUrl(fileUrl, pathModule = path7, fileUrlToPath = fileURLToPath) {
  return pathModule.dirname(fileUrlToPath(fileUrl));
}
function skillRelativeDir(repoRoot) {
  const opencodeDir = path7.join(repoRoot, ".opencode", "skills", "ai-code-tracker");
  if (fsSync.existsSync(opencodeDir)) {
    return ".opencode/skills/ai-code-tracker";
  }
  const claudeDir = path7.join(repoRoot, ".claude", "skills", "ai-code-tracker");
  if (fsSync.existsSync(claudeDir)) {
    return ".claude/skills/ai-code-tracker";
  }
  const scriptDir = moduleDirFromFileUrl(import.meta.url);
  const skillRoot = path7.resolve(scriptDir, "..", "..");
  const rel = path7.relative(repoRoot, skillRoot).replace(/\\/g, "/");
  if (rel.startsWith("..")) {
    return ".opencode/skills/ai-code-tracker";
  }
  return rel;
}
function hookScriptsForRepo(repoRoot) {
  const base = skillRelativeDir(repoRoot);
  return {
    "pre-commit": hookScript(`node --experimental-vm-modules "${base}/scripts/commit-stats.js" pre-commit`),
    "post-commit": hookScript(`node --experimental-vm-modules "${base}/scripts/commit-stats.js" post-commit`),
    "pre-push": hookScript(`node --experimental-vm-modules "${base}/scripts/commit-stats.js" pre-push`),
    "post-rewrite": hookScript(`node --experimental-vm-modules "${base}/scripts/commit-stats.js" prune`)
  };
}
function hookScript(command) {
  const logDir = ".ai-tracking";
  const tag = "[ai-code-tracker]";
  return [
    `__ait_err=$(${command} 2>&1) && __ait_rc=0 || __ait_rc=$?`,
    `if [ $__ait_rc -ne 0 ]; then`,
    `  echo "${tag} hook failed (exit $__ait_rc), continuing anyway" >&2`,
    `  echo "$__ait_err" >&2`,
    `  mkdir -p "${logDir}" 2>/dev/null`,
    `  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [ERROR] [hook] ${tag} hook failed (exit $__ait_rc)" >> "${logDir}/plugin.log"`,
    `  echo "$__ait_err" >> "${logDir}/plugin.log"`,
    `fi`
  ].join("\n  ");
}
async function runInstall(args = process.argv.slice(2), options = {}) {
  const mode = args.includes("--uninstall") ? "uninstall" : args.includes("--check") ? "check" : args.includes("--repair") ? "repair" : "install";
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = options.repoRoot ?? await gitRepoRoot(cwd);
  const timer = startTimer();
  await logInfo(repoRoot, `install.${mode}`, "enter");
  const hookScripts = hookScriptsForRepo(repoRoot);
  if (mode === "uninstall") {
    await uninstallFromRepo(repoRoot, hookScripts);
    await logInfo(repoRoot, "install.uninstall", "complete", { durationMs: timer.elapsedMs() });
    return { ok: true, uninstalled: true };
  }
  if (mode === "check") {
    const result2 = await checkInstall(repoRoot, hookScripts);
    if (!result2.ok) {
      const details = [
        ...result2.missing.map((m) => `missing: ${m}`),
        ...result2.mismatches.map((m) => `content mismatch: ${m}`)
      ];
      await logInfo(repoRoot, "install.check", "not installed", { missing: result2.missing, mismatches: result2.mismatches, durationMs: timer.elapsedMs() });
      throw new Error(`ai-code-tracker check failed: ${details.join(", ")}`);
    }
    await logInfo(repoRoot, "install.check", "passed", { durationMs: timer.elapsedMs() });
    return result2;
  }
  await installIntoRepo(repoRoot, hookScripts);
  const result = await checkInstall(repoRoot, hookScripts);
  await logInfo(repoRoot, `install.${mode}`, "complete", { ok: result.ok, missing: result.missing, mismatches: result.mismatches, durationMs: timer.elapsedMs() });
  return result;
}
async function checkInstall(repoRoot, hookScripts = hookScriptsForRepo(repoRoot)) {
  const missing = [];
  const mismatches = [];
  const tool = await detectActiveTool();
  const isOpencode = tool === "opencode";
  const isClaude = tool === "claude";
  for (const hookName of ["pre-commit", "post-commit", "pre-push", "post-rewrite"]) {
    const hook = path7.join(repoRoot, ".git", "hooks", hookName);
    if (!await hasEffectiveHook(hook, hookScripts[hookName])) {
      missing.push(`${hookName} hook`);
    }
  }
  const gitignorePath = path7.join(repoRoot, ".gitignore");
  if (await exists(gitignorePath)) {
    const gitignoreContent = await fs8.readFile(gitignorePath, "utf8");
    const existingLines = gitignoreContent.split(/\r?\n/);
    const missingLines = EXPECTED_GITIGNORE_LINES.filter((line) => !existingLines.includes(line));
    if (missingLines.length > 0) {
      mismatches.push(`gitignore (missing: ${missingLines.join(", ")})`);
    }
  } else {
    mismatches.push("gitignore (file not found)");
  }
  const cfg = configPath(repoRoot);
  if (!await exists(cfg)) {
    missing.push("tracker config");
  } else {
    try {
      const data = JSON.parse(await fs8.readFile(cfg, "utf8"));
      if (!data.enabled) {
        mismatches.push("tracker config");
      }
    } catch {
      mismatches.push("tracker config");
    }
  }
  if (isOpencode || !isOpencode && !isClaude) {
    const pluginContent = expectedPluginContent();
    if (!await exists(opencodePluginPath(repoRoot))) {
      missing.push("opencode plugin");
    } else {
      const actual = await fs8.readFile(opencodePluginPath(repoRoot), "utf8");
      if (actual.trimEnd() !== pluginContent.trimEnd()) {
        mismatches.push("opencode plugin");
      }
    }
    for (const file of OPENCODE_COMMAND_FILES) {
      const cmd = path7.join(repoRoot, ".opencode", "commands", file);
      if (!await exists(cmd)) {
        missing.push(`opencode command ${file}`);
      }
    }
  }
  if (isClaude || !isOpencode && !isClaude) {
    if (!await hasClaudeHooks(repoRoot)) {
      missing.push("Claude Code hooks");
    }
    for (const file of CLAUDE_COMMAND_FILES) {
      const cmd = path7.join(repoRoot, ".claude", "commands", file);
      if (!await exists(cmd)) {
        missing.push(`Claude Code command ${file}`);
      }
    }
  }
  return { ok: missing.length === 0 && mismatches.length === 0, missing, mismatches };
}
async function installIntoRepo(repoRoot, hookScripts = hookScriptsForRepo(repoRoot)) {
  await ensureWritableRepo(repoRoot);
  const tool = await detectActiveTool();
  const isOpencode = tool === "opencode";
  const isClaude = tool === "claude";
  await logInfo(repoRoot, "install", "detected tool", { tool });
  if (!await exists(configPath(repoRoot))) {
    let installedVersion = "0.1.0";
    try {
      const pkg = JSON.parse(await fs8.readFile(path7.join(repoRoot, "package.json"), "utf8"));
      if (pkg.name === "ai-commit-statistic-skill") {
        installedVersion = pkg.version || installedVersion;
      }
    } catch {
    }
    await logInfo(repoRoot, "install", "writing tracker config");
    await atomicWriteJson(configPath(repoRoot), expectedConfigObject(installedVersion));
  }
  await updateGitignore(repoRoot);
  await logInfo(repoRoot, "install", "injecting git hooks", { hooks: ["pre-commit", "post-commit", "pre-push", "post-rewrite"] });
  await injectHook(repoRoot, "pre-commit", hookScripts["pre-commit"]);
  await injectHook(repoRoot, "post-commit", hookScripts["post-commit"]);
  await injectHook(repoRoot, "pre-push", hookScripts["pre-push"]);
  await injectHook(repoRoot, "post-rewrite", hookScripts["post-rewrite"]);
  if (isOpencode) {
    await fs8.mkdir(path7.join(repoRoot, ".opencode", "plugins"), { recursive: true });
    await ensureOpencodePackage(repoRoot);
    await logInfo(repoRoot, "install", "writing opencode plugin");
    await writeExecutable(opencodePluginPath(repoRoot), expectedPluginContent());
    await logInfo(repoRoot, "install", "deploying opencode commands");
    await deployCommands(repoRoot, "opencode");
  }
  if (isClaude) {
    await logInfo(repoRoot, "install", "injecting Claude Code hooks");
    await injectClaudeHooks(repoRoot);
    await logInfo(repoRoot, "install", "deploying Claude Code commands");
    await deployCommands(repoRoot, "claude");
  }
  if (!isOpencode && !isClaude) {
    await fs8.mkdir(path7.join(repoRoot, ".opencode", "plugins"), { recursive: true });
    await ensureOpencodePackage(repoRoot);
    await logInfo(repoRoot, "install", "writing opencode plugin");
    await writeExecutable(opencodePluginPath(repoRoot), expectedPluginContent());
    await logInfo(repoRoot, "install", "injecting Claude Code hooks");
    await injectClaudeHooks(repoRoot);
    await logInfo(repoRoot, "install", "deploying commands for both tools");
    await deployCommands(repoRoot, "opencode");
    await deployCommands(repoRoot, "claude");
  }
  await ensureAgentsRule(repoRoot);
}
async function uninstallFromRepo(repoRoot, hookScripts = hookScriptsForRepo(repoRoot)) {
  await ensureWritableRepo(repoRoot);
  for (const hookName of ["pre-commit", "post-commit", "pre-push", "post-rewrite"]) {
    const hook = path7.join(repoRoot, ".git", "hooks", hookName);
    if (!await exists(hook)) {
      continue;
    }
    let content = await fs8.readFile(hook, "utf8");
    content = removeExistingBlock(content).trimEnd();
    if (!content || content === "#!/bin/sh") {
      await fs8.rm(hook, { force: true });
    } else {
      await fs8.writeFile(hook, `${content}
`, "utf8");
    }
  }
  await removeClaudeHooks(repoRoot);
  const plugin = opencodePluginPath(repoRoot);
  await fs8.rm(plugin, { force: true });
  for (const file of OPENCODE_COMMAND_FILES) {
    await fs8.rm(path7.join(repoRoot, ".opencode", "commands", file), { force: true });
  }
  for (const file of CLAUDE_COMMAND_FILES) {
    await fs8.rm(path7.join(repoRoot, ".claude", "commands", file), { force: true });
  }
  await fs8.rm(configPath(repoRoot), { force: true });
  await cleanGitignore(repoRoot);
  await cleanAgentsRule(repoRoot);
}
async function writeExecutable(destination, content) {
  await fs8.mkdir(path7.dirname(destination), { recursive: true });
  await fs8.writeFile(destination, content, "utf8");
  await fs8.chmod(destination, 493);
}
async function injectHook(repoRoot, hookName, command) {
  const hook = path7.join(repoRoot, ".git", "hooks", hookName);
  let content = "";
  if (await exists(hook)) {
    content = await fs8.readFile(hook, "utf8");
  }
  if (await hasEffectiveHook(hook, command)) {
    return;
  }
  content = removeExistingBlock(content);
  if (!content.startsWith("#!")) {
    content = `#!/bin/sh
${content}`;
  }
  const block = `
${BEGIN}
${command}
${END}
`;
  await fs8.writeFile(hook, insertBeforeTerminalExec(content, block), "utf8");
  await fs8.chmod(hook, 493);
}
function insertBeforeTerminalExec(content, block) {
  const execMatch = content.match(/^exec\b.*$/m);
  if (!execMatch || execMatch.index === void 0) {
    return `${content.trimEnd()}
${block}`;
  }
  const before = content.slice(0, execMatch.index).trimEnd();
  const after = content.slice(execMatch.index).trimStart();
  return `${before}
${block}${after.trimEnd()}
`;
}
function removeExistingBlock(content) {
  const pattern = new RegExp(`\\n?${escapeRegExp(BEGIN)}\\n[\\s\\S]*?\\n${escapeRegExp(END)}\\n?`, "g");
  return content.replace(pattern, "\n");
}
async function hasEffectiveHook(hook, script) {
  let content;
  try {
    content = await fs8.readFile(hook, "utf8");
  } catch {
    return false;
  }
  const blockIndex = content.indexOf(BEGIN);
  if (blockIndex === -1) {
    return false;
  }
  const endIndex = content.indexOf(END, blockIndex);
  if (endIndex === -1) {
    return false;
  }
  const blockBody = content.slice(blockIndex + BEGIN.length + 1, endIndex);
  if (blockBody.trimEnd() !== script.trimEnd()) {
    return false;
  }
  const execMatch = content.match(/^exec\b.*$/m);
  return !execMatch || execMatch.index === void 0 || blockIndex < execMatch.index;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var EXPECTED_GITIGNORE_LINES = [
  ".ai-tracking/pending-lines.json",
  ".ai-tracking/pending-commit.json",
  ".ai-tracking/tracking-message.txt",
  ".ai-tracking/errors.log",
  ".ai-tracking/plugin.log",
  ".ai-tracking/plugin.log.*",
  ".ai-tracking/*.lock",
  ".ai-tracking/archive/",
  ".ai-tracking/snapshots/",
  ".ai-tracking/config.json",
  ".ai-tracking/available-update.json",
  ".ai-tracking/backup-pre-update/"
];
var CLAUDE_HOOK_MATCHER = "Edit|Write|NotebookEdit|Bash";
function claudeHookCommand() {
  return 'node --experimental-vm-modules ".claude/skills/ai-code-tracker/scripts/claude-code-hook.js"';
}
async function detectActiveTool() {
  if (process.env.CLAUDE_CODE || process.env.CLAUDE_CODE_SESSION) {
    return "claude";
  }
  if (process.env.OPENCODE_SESSION || process.env.CODEAGENT_SESSION) {
    return "opencode";
  }
  const envTree = process.env.AI_CODE_TRACKER_PROCESS_TREE;
  if (envTree !== void 0) {
    const lower = envTree.toLowerCase();
    if (/\bclaude\b/.test(lower)) {
      return "claude";
    }
    if (/\bopencode\b/.test(lower) || /\bcodeagent\b/.test(lower)) {
      return "opencode";
    }
    return "unknown";
  }
  if (process.platform === "win32") {
    const tree = await readWindowsProcessTree2();
    if (/\bclaude\b/.test(tree)) {
      return "claude";
    }
    if (/\bopencode\b/.test(tree) || /\bcodeagent\b/.test(tree)) {
      return "opencode";
    }
  } else {
    let pid = process.ppid;
    for (let i = 0; i < 10 && pid > 1; i++) {
      const stat = await readProcStat2(pid) ?? await readPsStat2(pid);
      if (!stat) {
        break;
      }
      const cmd = stat.command.toLowerCase();
      if (/\bclaude\b/.test(cmd)) {
        return "claude";
      }
      if (/\bopencode\b/.test(cmd) || /\bcodeagent\b/.test(cmd)) {
        return "opencode";
      }
      pid = stat.parentPid;
    }
  }
  return "unknown";
}
async function readWindowsProcessTree2() {
  const script = `
$pidToRead = ${process.ppid}
for ($i = 0; $i -lt 10 -and $pidToRead -gt 0; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$pidToRead"
  if ($null -eq $p) { break }
  ($p.Name + " " + $p.CommandLine)
  $pidToRead = [int]$p.ParentProcessId
}`;
  try {
    const { stdout } = await execFileAsync3("powershell.exe", ["-NoProfile", "-Command", script], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 5e3
    });
    return stdout.toLowerCase();
  } catch {
    return "";
  }
}
async function readProcStat2(pid) {
  try {
    const stat = await fs8.readFile(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    const openParen = stat.indexOf("(");
    if (openParen === -1 || closeParen === -1) {
      return null;
    }
    const command = stat.slice(openParen + 1, closeParen);
    const rest = stat.slice(closeParen + 2).split(" ");
    return { command, parentPid: Number(rest[1] || 0) };
  } catch {
    return null;
  }
}
async function readPsStat2(pid) {
  try {
    const { stdout } = await execFileAsync3("ps", ["-o", "ppid=", "-o", "comm=", "-p", String(pid)], {
      maxBuffer: 1024 * 1024,
      timeout: 3e3
    });
    const match = stdout.trim().match(/^(\d+)\s+(.+)$/u);
    if (!match) {
      return null;
    }
    return { parentPid: Number(match[1]), command: match[2] };
  } catch {
    return null;
  }
}
async function updateGitignore(repoRoot) {
  const gitignore = path7.join(repoRoot, ".gitignore");
  let content = "";
  if (await exists(gitignore)) {
    content = await fs8.readFile(gitignore, "utf8");
  }
  const additions = EXPECTED_GITIGNORE_LINES.filter((line) => !content.split(/\r?\n/).includes(line));
  if (additions.length === 0) {
    return;
  }
  const prefix = content && !content.endsWith("\n") ? "\n" : "";
  await fs8.writeFile(gitignore, `${content}${prefix}${additions.join("\n")}
`, "utf8");
}
async function ensureAgentsRule(repoRoot, tool) {
  const agents = path7.join(repoRoot, "AGENTS.md");
  const rule = `## AI Code Tracker

Before modifying code in this repository, load the opencode skill \`ai-code-tracker\` and run its preflight check. If tracking is not installed or is broken, ask the user whether to install or repair it. If the user confirms, run the project-level install or repair script automatically, rerun preflight, and continue with code changes only after preflight passes.

After installing or repairing ai-code-tracker, tell the user to restart the current opencode session because project plugins are loaded at opencode startup.

When cherry-picking commits, always use \`git cherry-pick -x\` to preserve the source commit reference. This allows ai-code-tracker to copy the original AI line statistics into the cherry-picked commit's tracking record.
`;
  let content = "";
  if (await exists(agents)) {
    content = await fs8.readFile(agents, "utf8");
  }
  if (content.includes("## AI Code Tracker")) {
    if (!content.includes("cherry-pick -x")) {
      await fs8.writeFile(agents, `${content.trimEnd()}

When cherry-picking commits, always use \`git cherry-pick -x\` to preserve the source commit reference. This allows ai-code-tracker to copy the original AI line statistics into the cherry-picked commit's tracking record.
`, "utf8");
    }
    return;
  }
  const prefix = content && !content.endsWith("\n") ? "\n\n" : "";
  await fs8.writeFile(agents, `${content}${prefix}${rule}`, "utf8");
}
async function ensureOpencodePackage(repoRoot) {
  const packageFile = path7.join(repoRoot, ".opencode", "package.json");
  let data = {};
  try {
    data = JSON.parse(await fs8.readFile(packageFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  if (data.type === "module") {
    return;
  }
  data.type = "module";
  await fs8.writeFile(packageFile, `${JSON.stringify(data, null, 2)}
`, "utf8");
}
function expectedPluginContent() {
  return 'export { AiCodeTrackerPlugin } from "../skills/ai-code-tracker/scripts/opencode-plugin.js";\n';
}
function expectedConfigObject(version) {
  return {
    enabled: true,
    count_blank_lines: false,
    tracking_commit_suffix: "[ai-tracking]",
    auto_tracking_commit: true,
    installed_version: version || "0.1.0",
    source_repo: "https://github.com/yooocen/git-code-tracker",
    check_updates: true,
    update_check_interval_hours: 24,
    last_update_check: null
  };
}
var OPENCODE_COMMAND_FILES = ["ai-install.md", "ai-repair.md", "ai-check.md", "ai-stats.md", "ai-uninstall.md", "ai-update.md"];
var CLAUDE_COMMAND_FILES = ["ai-install.md", "ai-repair.md", "ai-check.md", "ai-stats.md", "ai-uninstall.md", "ai-update.md"];
async function deployCommands(repoRoot, tool) {
  const scriptDir = moduleDirFromFileUrl(import.meta.url);
  let commandsDir = path7.join(path7.dirname(scriptDir), "commands", tool);
  if (!await exists(commandsDir)) {
    const projectRoot = await gitRepoRoot(scriptDir);
    commandsDir = path7.join(projectRoot, tool === "claude" ? ".claude" : ".opencode", "skills", "ai-code-tracker", "commands", tool);
  }
  const destDir = tool === "opencode" ? path7.join(repoRoot, ".opencode", "commands") : path7.join(repoRoot, ".claude", "commands");
  const files = tool === "opencode" ? OPENCODE_COMMAND_FILES : CLAUDE_COMMAND_FILES;
  await fs8.mkdir(destDir, { recursive: true });
  for (const file of files) {
    const srcFile = path7.join(commandsDir, file);
    if (await exists(srcFile)) {
      await fs8.copyFile(srcFile, path7.join(destDir, file));
    }
  }
}
async function ensureWritableRepo(repoRoot) {
  const gitDir = path7.join(repoRoot, ".git");
  if (!await exists(gitDir)) {
    throw new Error(`Not a git repository: ${repoRoot}`);
  }
  await fs8.access(repoRoot);
}
function claudeSettingsPath(repoRoot) {
  return path7.join(repoRoot, ".claude", "settings.json");
}
async function injectClaudeHooks(repoRoot) {
  const settingsFile = claudeSettingsPath(repoRoot);
  await fs8.mkdir(path7.dirname(settingsFile), { recursive: true });
  let settings = {};
  try {
    settings = JSON.parse(await fs8.readFile(settingsFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  settings.hooks = settings.hooks ?? {};
  const expected = expectedClaudeHooks();
  for (const event of ["PreToolUse", "PostToolUse"]) {
    const hookDef = expected[event][0];
    const arr = settings.hooks[event] ?? [];
    const existing = arr.find((e) => e.matcher === hookDef.matcher);
    if (existing) {
      const hasCommand = existing.hooks?.some((h) => h.command === hookDef.hooks[0].command);
      if (!hasCommand) {
        existing.hooks = [...existing.hooks ?? [], ...hookDef.hooks];
      }
    } else {
      arr.push(hookDef);
    }
    settings.hooks[event] = arr;
  }
  await fs8.writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}
`, "utf8");
}
function expectedClaudeHooks() {
  const cmd = claudeHookCommand();
  return {
    PreToolUse: [
      {
        matcher: CLAUDE_HOOK_MATCHER,
        hooks: [{ type: "command", command: `${cmd} pre` }]
      }
    ],
    PostToolUse: [
      {
        matcher: CLAUDE_HOOK_MATCHER,
        hooks: [{ type: "command", command: `${cmd} post` }]
      }
    ]
  };
}
async function hasClaudeHooks(repoRoot) {
  const settingsFile = claudeSettingsPath(repoRoot);
  let settings;
  try {
    settings = JSON.parse(await fs8.readFile(settingsFile, "utf8"));
  } catch {
    return false;
  }
  const expected = expectedClaudeHooks();
  for (const event of ["PreToolUse", "PostToolUse"]) {
    const hookDef = expected[event][0];
    const arr = settings.hooks?.[event];
    if (!Array.isArray(arr)) {
      return false;
    }
    const entry = arr.find((e) => e.matcher === hookDef.matcher);
    if (!entry) {
      return false;
    }
    const hasCommand = entry.hooks?.some((h) => h.command === hookDef.hooks[0].command);
    if (!hasCommand) {
      return false;
    }
  }
  return true;
}
async function removeClaudeHooks(repoRoot) {
  const settingsFile = claudeSettingsPath(repoRoot);
  let settings;
  try {
    settings = JSON.parse(await fs8.readFile(settingsFile, "utf8"));
  } catch {
    return;
  }
  if (!settings.hooks) {
    await writeSettings(settingsFile, settings);
    return;
  }
  const cmds = [
    claudeHookCommand(),
    'node --experimental-vm-modules ".opencode/skills/ai-code-tracker/scripts/claude-code-hook.js"'
  ];
  for (const event of ["PreToolUse", "PostToolUse"]) {
    const arr = settings.hooks[event];
    if (!Array.isArray(arr)) {
      continue;
    }
    settings.hooks[event] = arr.filter((entry) => {
      if (entry.matcher !== CLAUDE_HOOK_MATCHER) {
        return true;
      }
      entry.hooks = (entry.hooks ?? []).filter((h) => !cmds.some((cmd) => h.command === `${cmd} pre` || h.command === `${cmd} post`));
      return entry.hooks.length > 0;
    });
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }
  await writeSettings(settingsFile, settings);
}
async function cleanGitignore(repoRoot) {
  const gitignore = path7.join(repoRoot, ".gitignore");
  if (!await exists(gitignore)) {
    return;
  }
  let content = await fs8.readFile(gitignore, "utf8");
  const lines = content.split(/\r?\n/);
  const cleaned = lines.filter((line) => !EXPECTED_GITIGNORE_LINES.includes(line));
  const result = cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  if (!result) {
    await fs8.rm(gitignore, { force: true });
  } else {
    await fs8.writeFile(gitignore, `${result}
`, "utf8");
  }
}
async function cleanAgentsRule(repoRoot) {
  const agents = path7.join(repoRoot, "AGENTS.md");
  if (!await exists(agents)) {
    return;
  }
  let content = await fs8.readFile(agents, "utf8");
  const marker = "## AI Code Tracker";
  const idx = content.indexOf(marker);
  if (idx === -1) {
    return;
  }
  const before = content.slice(0, idx).trimEnd();
  const result = before.trimEnd();
  if (!result) {
    await fs8.rm(agents, { force: true });
  } else {
    await fs8.writeFile(agents, `${result}
`, "utf8");
  }
}
async function writeSettings(settingsFile, settings) {
  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
  await fs8.writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}
`, "utf8");
}
async function exists(file) {
  try {
    await fs8.access(file);
    return true;
  } catch {
    return false;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  runInstall().then((result) => {
    if (result?.uninstalled) {
      console.log("ai-code-tracker uninstalled");
    } else if (result?.ok) {
      console.log("ai-code-tracker installed");
    }
  }).catch((error) => {
    console.error(`[ai-code-tracker] ${error.message}`);
    process.exitCode = 1;
  });
}

// src/claude-code/claude-code-hook.js
import fs9 from "node:fs/promises";
import path8 from "node:path";
init_lineStore();
init_paths();
init_logger();
var STALE_MS = 10 * 60 * 1e3;
async function runClaudeCodeHook(mode, options = {}) {
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
  const absolutePath = path8.resolve(toPosixPath(cwd), toPosixPath(filePath));
  const relative = path8.relative(repoRoot, absolutePath).replaceAll(path8.sep, "/");
  if (shouldIgnore(relative)) return;
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
    await fs9.mkdir(dir, { recursive: true });
    const before = await safeRead(absolutePath);
    const snapshot = { content: before, filePath: relative, timestamp: Date.now() };
    await fs9.writeFile(path8.join(dir, `${toolUseId}.json`), JSON.stringify(snapshot), "utf8");
    const originalFile = path8.join(dir, originalSnapshotName(relative));
    if (!await exists2(originalFile)) {
      await fs9.writeFile(originalFile, JSON.stringify(snapshot), "utf8");
    }
    await logInfo(repoRoot, "claude-code.pre", "captured snapshot", { file: relative });
  } catch (error) {
    await logError(repoRoot, "claude-code.pre", error.message, { file: relative });
  }
}
async function handlePost({ repoRoot, absolutePath, relative, toolUseId, config }) {
  try {
    const dir = snapshotDir(repoRoot);
    const snapshotFile = path8.join(dir, `${toolUseId}.json`);
    let snapshot;
    try {
      snapshot = JSON.parse(await fs9.readFile(snapshotFile, "utf8"));
    } catch {
      return;
    }
    const originalFile = path8.join(dir, originalSnapshotName(relative));
    let original;
    try {
      original = JSON.parse(await fs9.readFile(originalFile, "utf8"));
    } catch {
      original = snapshot;
    }
    const isNewFile = original.content === void 0 || original.content === null || original.content === "";
    const after = await safeRead(absolutePath);
    const added = isNewFile ? String(after).split(/\r?\n/) : addedLines(original.content, after);
    if (added.length > 0) {
      await appendPendingLines(repoRoot, relative, added, {
        countBlankLines: config.count_blank_lines,
        dedupeExisting: true,
        replace: true
      });
    } else {
      await appendPendingLines(repoRoot, relative, [], { replace: true });
    }
    await fs9.rm(snapshotFile, { force: true });
    await logInfo(repoRoot, "claude-code.post", "recorded added lines", { file: relative, addedLines: added.length });
  } catch (error) {
    await logError(repoRoot, "claude-code.post", error.message, { file: relative });
  }
}
async function handleBashPre({ repoRoot, toolUseId }) {
  try {
    await cleanStaleSnapshots(repoRoot);
    const state = await captureGitFileHashes(repoRoot);
    const dir = snapshotDir(repoRoot);
    await fs9.mkdir(dir, { recursive: true });
    await fs9.writeFile(path8.join(dir, `bash-${toolUseId}.json`), JSON.stringify(state), "utf8");
    await logInfo(repoRoot, "claude-code.bash-pre", "captured file hashes", { files: Object.keys(state).length });
  } catch (error) {
    await logError(repoRoot, "claude-code.bash-pre", error.message);
  }
}
async function handleBashPost({ repoRoot, toolUseId, config }) {
  try {
    const dir = snapshotDir(repoRoot);
    const snapshotFile = path8.join(dir, `bash-${toolUseId}.json`);
    let prevHashes;
    try {
      prevHashes = JSON.parse(await fs9.readFile(snapshotFile, "utf8"));
    } catch {
      return;
    }
    const currentHashes = await captureGitFileHashes(repoRoot);
    const { loadPendingLines: loadPendingLines2 } = await Promise.resolve().then(() => (init_lineStore(), lineStore_exports));
    const pending = await loadPendingLines2(repoRoot);
    let trackedCount = 0;
    for (const [file, hash] of Object.entries(currentHashes)) {
      if (shouldIgnore(file)) continue;
      if (prevHashes[file] === hash) continue;
      const absolutePath = path8.join(repoRoot, file);
      const content = await safeRead(absolutePath);
      const lines = content.split(/\r?\n/).filter((l) => config.count_blank_lines || l.trim() !== "");
      if (lines.length > 0) {
        await appendPendingLines(repoRoot, file, lines, { countBlankLines: config.count_blank_lines, dedupeExisting: true, replace: true });
        trackedCount++;
      }
    }
    await fs9.rm(snapshotFile, { force: true });
    await logInfo(repoRoot, "claude-code.bash-post", "processed", { trackedFiles: trackedCount });
  } catch (error) {
    await logError(repoRoot, "claude-code.bash-post", error.message);
  }
}
async function captureGitFileHashes(repoRoot) {
  const [modifiedRaw, stagedRaw, untrackedRaw] = await Promise.all([
    git(["diff", "--name-only"], { cwd: repoRoot }).catch(() => ""),
    git(["diff", "--cached", "--name-only"], { cwd: repoRoot }).catch(() => ""),
    git(["ls-files", "--others", "--exclude-standard"], { cwd: repoRoot }).catch(() => "")
  ]);
  const files = [.../* @__PURE__ */ new Set([
    ...modifiedRaw.split("\n").filter(Boolean),
    ...stagedRaw.split("\n").filter(Boolean),
    ...untrackedRaw.split("\n").filter(Boolean)
  ])];
  const hashes = {};
  await Promise.all(files.map(async (file) => {
    try {
      const content = await fs9.readFile(path8.join(repoRoot, file));
      const { createHash: createHash2 } = await import("node:crypto");
      hashes[file] = createHash2("md5").update(content).digest("hex");
    } catch {
      hashes[file] = "";
    }
  }));
  return hashes;
}
async function cleanStaleSnapshots(repoRoot) {
  const dir = snapshotDir(repoRoot);
  let entries;
  try {
    entries = await fs9.readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_MS;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const stat = await fs9.stat(path8.join(dir, entry));
      if (stat.mtimeMs < cutoff) await fs9.rm(path8.join(dir, entry), { force: true });
    } catch {
    }
  }
}
function toPosixPath(p) {
  return String(p).replaceAll("\\", "/");
}
function originalSnapshotName(relative) {
  return `original-${relative.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
}
async function exists2(file) {
  try {
    await fs9.access(file);
    return true;
  } catch {
    return false;
  }
}
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  runClaudeCodeHook(process.argv[2]).catch(() => {
  });
}

// src/opencode/ai-code-tracker.js
import fs10 from "node:fs/promises";
import path9 from "node:path";
import { createHash } from "node:crypto";
init_lineStore();
init_logger();
var beforeSnapshots = /* @__PURE__ */ new Map();
var originalSnapshots = /* @__PURE__ */ new Map();
var pendingFileEditedTimers = /* @__PURE__ */ new Map();
var BASH_FALLBACK_MS = 3e4;
var bashBaselineHashes = null;
var bashBaselineRepoRoot = null;
var bashFallbackTimer = null;
async function recordEditedFile({ cwd = process.cwd(), filePath, before, after = "", replace = false }) {
  const timer = startTimer();
  const repoRoot = await gitRepoRoot(cwd);
  const relative = path9.relative(repoRoot, path9.resolve(cwd, filePath)).replaceAll(path9.sep, "/");
  const config = await loadConfig(repoRoot);
  if (!config.enabled) {
    await logInfo(repoRoot, "recordEditedFile", "skipped: disabled", { file: relative });
    return { skipped: "disabled" };
  }
  if (shouldIgnore(relative)) {
    await logInfo(repoRoot, "recordEditedFile", "skipped: ignored", { file: relative });
    return { skipped: "ignored" };
  }
  const isNewFile = before === void 0 || before === null || before === "";
  const added = isNewFile ? String(after).split(/\r?\n/) : addedLines(before, after);
  await appendPendingLines(repoRoot, relative, added, {
    countBlankLines: config.count_blank_lines,
    dedupeExisting: true,
    replace
  });
  await logInfo(repoRoot, "recordEditedFile", "recorded added lines", { file: relative, addedLines: added.length, newFile: isNewFile, durationMs: timer.elapsedMs() });
  return { recorded: added.length };
}
var AiCodeTrackerPlugin = async ({ directory, worktree, client } = {}) => {
  const cwd = worktree ?? directory ?? process.cwd();
  let repoRootForLog;
  try {
    repoRootForLog = await gitRepoRoot(cwd);
  } catch {
    repoRootForLog = null;
  }
  await log(client, "info", "ai-code-tracker plugin initialized", { cwd });
  if (repoRootForLog) await logInfo(repoRootForLog, "plugin.init", "ai-code-tracker plugin initialized", { cwd });
  if (repoRootForLog) {
    checkVersion(repoRootForLog).then((update) => {
      if (update) {
        log(client, "warn", `ai-code-tracker \u5347\u7EA7\u53EF\u7528: ${update.local_version} \u2192 ${update.remote_version}\uFF0C\u8FD0\u884C /ai-update \u5347\u7EA7`);
      }
    }).catch(() => {
    });
  }
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
          after: await safeRead(path9.resolve(eventCwd, filePath))
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
      const content = await safeRead(path9.resolve(cwd, filePath));
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
        after: await safeRead(path9.resolve(cwd, filePath)),
        replace: true
      });
    }
  };
};
async function handleBashBefore({ cwd, tool, args }) {
  try {
    const repoRoot = await gitRepoRoot(cwd);
    const currentHashes = await captureGitFileHashes2(repoRoot);
    if (bashBaselineHashes && bashBaselineRepoRoot === repoRoot) {
      await recordBashChanges(bashBaselineHashes, currentHashes, repoRoot);
      bashBaselineHashes = null;
    }
    bashBaselineHashes = currentHashes;
    bashBaselineRepoRoot = repoRoot;
    if (bashFallbackTimer) clearTimeout(bashFallbackTimer);
    bashFallbackTimer = setTimeout(async () => {
      bashFallbackTimer = null;
      if (!bashBaselineHashes || bashBaselineRepoRoot !== repoRoot) return;
      try {
        const afterHashes = await captureGitFileHashes2(bashBaselineRepoRoot);
        await recordBashChanges(bashBaselineHashes, afterHashes, bashBaselineRepoRoot);
      } catch {
      }
    }, BASH_FALLBACK_MS);
    await logInfo(repoRoot, "tool.execute.before", "captured bash file hashes", { files: Object.keys(currentHashes).length });
  } catch (error) {
    await logInfo(cwd, "tool.execute.before", `bash-pre error: ${error.message}`);
  }
}
async function handleBashAfter({ cwd, tool, args }) {
  if (bashFallbackTimer) {
    clearTimeout(bashFallbackTimer);
    bashFallbackTimer = null;
  }
  try {
    const repoRoot = bashBaselineRepoRoot ?? await gitRepoRoot(cwd).catch(() => null);
    const prevHashes = bashBaselineHashes;
    bashBaselineHashes = null;
    if (!prevHashes || !repoRoot) return;
    const currentHashes = await captureGitFileHashes2(repoRoot);
    await recordBashChanges(prevHashes, currentHashes, repoRoot);
  } catch (error) {
    await logInfo(cwd, "tool.execute.after", `bash-post error: ${error.message}`);
  }
}
async function recordBashChanges(prevHashes, currentHashes, repoRoot) {
  const config = await loadConfig(repoRoot);
  if (!config.enabled) return;
  const pending = await loadPendingLines(repoRoot);
  let trackedCount = 0;
  for (const [file, currentHash] of Object.entries(currentHashes)) {
    if (shouldIgnore(file)) continue;
    const absolutePath = path9.join(repoRoot, file);
    const content = await safeRead(absolutePath);
    const lines = content.split(/\r?\n/).filter((l) => config.count_blank_lines || l.trim() !== "");
    const existing = pending[file];
    let shouldRecord = false;
    if (existing) {
      const existingContents = existing.map((e) => e.content);
      const contentUnchanged = lines.length === existingContents.length && lines.every((l, i) => l === existingContents[i]);
      shouldRecord = !contentUnchanged && (lines.length > 0 || existingContents.length > 0);
    } else {
      shouldRecord = prevHashes[file] !== currentHash && lines.length > 0;
    }
    if (shouldRecord) {
      await appendPendingLines(repoRoot, file, lines, {
        countBlankLines: config.count_blank_lines,
        dedupeExisting: true,
        replace: true
      });
      trackedCount++;
    }
  }
  await logInfo(repoRoot, "tool.execute.after", "bash-changes recorded", { trackedFiles: trackedCount });
}
async function captureGitFileHashes2(repoRoot) {
  const [modifiedRaw, stagedRaw, untrackedRaw] = await Promise.all([
    git(["diff", "--name-only"], { cwd: repoRoot }).catch(() => ""),
    git(["diff", "--cached", "--name-only"], { cwd: repoRoot }).catch(() => ""),
    git(["ls-files", "--others", "--exclude-standard"], { cwd: repoRoot }).catch(() => "")
  ]);
  const files = [.../* @__PURE__ */ new Set([
    ...modifiedRaw.split("\n").filter(Boolean),
    ...stagedRaw.split("\n").filter(Boolean),
    ...untrackedRaw.split("\n").filter(Boolean)
  ])];
  const hashes = {};
  await Promise.all(files.map(async (file) => {
    try {
      const content = await fs10.readFile(path9.join(repoRoot, file));
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
  return path9.resolve(cwd, filePath);
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
        extra
      }
    });
  } catch {
  }
}
export {
  AiCodeTrackerPlugin,
  recordEditedFile,
  runAiCodeStats,
  runAiCodeUpdate,
  runClaudeCodeHook,
  runCommitStats,
  runInstall
};
