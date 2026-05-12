#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendRecord, pruneStaleRecords } from "../tracker/csv.js";
import { git, gitRaw, gitRepoRoot } from "../tracker/git.js";
import { parseAddedLinesFromDiff } from "../tracker/diff.js";
import { buildPendingCommit } from "../tracker/stats.js";
import { consumeMatchedLines, loadPendingLines, savePendingLines } from "../tracker/lineStore.js";
import { atomicWriteJson, atomicWriteText } from "../tracker/lock.js";
import { archiveDir, authorCsvPath, configPath, pendingCommitPath, pendingLinesPath, trackingMessagePath } from "../tracker/paths.js";

const execFileAsync = promisify(execFile);

export async function runCommitStats(mode, options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const gitImpl = options.git ?? git;
  const gitRawImpl = options.gitRaw ?? gitRaw;
  const repoRoot = options.repoRoot ?? await gitRepoRoot(cwd);

  if (env.AI_CODE_TRACKER_SKIP === "1") return { skipped: "skip-env" };

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

async function runPrePush({ repoRoot, now = new Date() }) {
  const files = [pendingLinesPath(repoRoot), pendingCommitPath(repoRoot), trackingMessagePath(repoRoot)];
  const existing = [];
  for (const file of files) {
    try {
      await fs.access(file);
      existing.push(file);
    } catch {
      // Missing pending files are already clean.
    }
  }

  if (existing.length === 0) return { skipped: "no-pending-files" };

  const target = path.join(archiveDir(repoRoot), archiveStamp(now));
  await fs.mkdir(target, { recursive: true });
  for (const file of existing) {
    await fs.copyFile(file, path.join(target, path.basename(file)));
    await fs.rm(file, { force: true });
  }

  return { archived: existing.map((file) => path.basename(file)), archive: target };
}

async function runPreCommit({ repoRoot, gitRawImpl, env, processTreeReader }) {
  const diff = await gitRawImpl(["diff", "--cached", "--unified=0"], { cwd: repoRoot });
  const addedLines = removeTrackingFiles(parseAddedLinesFromDiff(diff));
  const pendingLines = await loadPendingLines(repoRoot);
  const pendingCommit = buildPendingCommit({ pendingLines, addedLines });

  const withCommitSource = {
    ...pendingCommit,
    is_ai_commit: await isAiCreatedCommit(env, { processTreeReader }),
  };

  await atomicWriteJson(pendingCommitPath(repoRoot), withCommitSource, {
    operation: "write pending commit tracking stats",
  });
  return { written: withCommitSource };
}

async function runPostCommit({ repoRoot, gitImpl, gitRawImpl, env }) {
  if (Number(env.AI_CODE_TRACKER_DEPTH || "0") > 0) {
    throw new Error("Refusing recursive ai-code-tracker post-commit execution");
  }

  const subject = await gitImpl(["log", "-1", "--pretty=%s"], { cwd: repoRoot });
  if (subject.includes("[ai-tracking]")) return { skipped: "tracking-commit" };

  const pendingPath = pendingCommitPath(repoRoot);
  let pendingCommit;
  try {
    pendingCommit = JSON.parse(await fs.readFile(pendingPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { skipped: "no-pending-commit" };
    throw error;
  }

  const commitId = await gitImpl(["rev-parse", "HEAD"], { cwd: repoRoot });
  const author = await gitImpl(["log", "-1", "--pretty=%an"], { cwd: repoRoot });
  const date = formatCommitDate(await gitImpl(["log", "-1", "--pretty=%ad", "--date=iso-strict"], { cwd: repoRoot }));
  const fullMessage = await gitRawImpl(["log", "-1", "--pretty=%B"], { cwd: repoRoot });
  const messageSubject = fullMessage.split(/\r?\n/)[0] || subject;

  const csvPath = authorCsvPath(repoRoot, author);
  await appendRecord(csvPath, {
    author,
    ai_lines: pendingCommit.ai_lines,
    total_lines: pendingCommit.total_lines,
    is_ai_commit: pendingCommit.is_ai_commit === true,
    commit_id: commitId,
    date,
    message: messageSubject,
  });

  await atomicWriteText(trackingMessagePath(repoRoot), trackingMessage(fullMessage), {
    operation: "write tracking commit message",
  });
  await stageTrackingFiles({ repoRoot, gitImpl, csvPath });
  await assertOnlyTrackingStaged(repoRoot, gitRawImpl);

  await gitImpl(["commit", "-F", ".ai-tracking/tracking-message.txt"], {
    cwd: repoRoot,
    env: { ...process.env, AI_CODE_TRACKER_SKIP: "1", AI_CODE_TRACKER_DEPTH: "1" },
  });

  const pendingLines = await loadPendingLines(repoRoot);
  await savePendingLines(repoRoot, consumeMatchedLines(pendingLines, pendingCommit.matched_lines));
  await fs.rm(pendingPath, { force: true });
  await fs.rm(trackingMessagePath(repoRoot), { force: true });

  return { committed: true };
}

async function stageTrackingFiles({ repoRoot, gitImpl, csvPath }) {
  await gitImpl(["add", configPath(repoRoot), csvPath], { cwd: repoRoot });
  await gitImpl([
    "rm",
    "--cached",
    "-f",
    "--ignore-unmatch",
    pendingLinesPath(repoRoot),
    pendingCommitPath(repoRoot),
    trackingMessagePath(repoRoot),
  ], { cwd: repoRoot });
}

async function assertOnlyTrackingStaged(repoRoot, gitRawImpl) {
  const names = (await gitRawImpl(["diff", "--cached", "--name-only"], { cwd: repoRoot }))
    .split(/\r?\n/)
    .filter(Boolean);
  const invalid = names.filter((name) => !name.startsWith(".ai-tracking/"));
  if (invalid.length > 0) {
    throw new Error(`Refusing tracking commit with non-tracking staged files: ${invalid.join(", ")}`);
  }
}

function removeTrackingFiles(addedLines) {
  return Object.fromEntries(
    Object.entries(addedLines).filter(([filePath]) => !filePath.startsWith(".ai-tracking/")),
  );
}

function trackingMessage(fullMessage) {
  const lines = String(fullMessage || "").replace(/\s+$/u, "").split(/\r?\n/);
  const subject = lines.shift() || "AI code tracking";
  return [`${subject} [ai-tracking]`, ...lines].join("\n").trimEnd() + "\n";
}

function formatCommitDate(value) {
  return String(value || "").replace("T", " ").replace(/([+-]\d{2}:\d{2}|Z)$/u, "");
}

function archiveStamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/u, "Z").replace(/[:]/g, "");
}

async function isAiCreatedCommit(env, options = {}) {
  if (env.AI_CODE_TRACKER_AI_COMMIT === "1") return true;
  if (env.AI_CODE_TRACKER_PROCESS_TREE) return includesOpencode(env.AI_CODE_TRACKER_PROCESS_TREE);
  const processTree = options.processTreeReader ? await options.processTreeReader() : await readProcessTree();
  return includesOpencode(processTree);
}

async function readProcessTree() {
  if (process.platform === "win32") return readWindowsProcessTree();
  return readPosixProcessTree();
}

async function readPosixProcessTree() {
  const commands = [];
  let pid = process.ppid;
  const seen = new Set();

  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid);
    const stat = await readProcStat(pid) ?? await readPsStat(pid);
    if (!stat) break;
    commands.push(stat.command);
    pid = stat.parentPid;
  }

  return commands.join("\n");
}

async function readWindowsProcessTree(startPid = process.ppid, execFileImpl = execFileAsync) {
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
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch {
    return "";
  }
}

async function readProcStat(pid) {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    const openParen = stat.indexOf("(");
    if (openParen === -1 || closeParen === -1) return null;
    const command = stat.slice(openParen + 1, closeParen);
    const rest = stat.slice(closeParen + 2).split(" ");
    return { command, parentPid: Number(rest[1] || 0) };
  } catch {
    return null;
  }
}

async function readPsStat(pid, execFileImpl = execFileAsync) {
  try {
    const { stdout } = await execFileImpl("ps", ["-o", "ppid=", "-o", "comm=", "-p", String(pid)], {
      maxBuffer: 1024 * 1024,
    });
    const line = stdout.trim();
    const match = line.match(/^(\d+)\s+(.+)$/u);
    if (!match) return null;
    return { parentPid: Number(match[1]), command: match[2] };
  } catch {
    return null;
  }
}

function includesOpencode(processTree) {
  return String(processTree || "").split(/\r?\n/).some((command) => /(^|[\\/\s])opencode(?:\.exe)?($|[\\/\s])/i.test(command));
}

async function pruneCsvRecordsIfPossible(repoRoot, gitImpl) {
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
    // Pruning should not block commits; the next successful tracker run can retry.
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCommitStats(process.argv[2]).catch((error) => {
    console.error(`[ai-code-tracker] ${error.message}`);
    process.exitCode = 1;
  });
}
