#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitRepoRoot } from "../tracker/git.js";
import {
  configPath,
  opencodePluginPath,
} from "../tracker/paths.js";
import { atomicWriteJson } from "../tracker/lock.js";
import { logInfo, startTimer } from "../tracker/logger.js";

const execFileAsync = promisify(execFile);

const BEGIN = "# ai-code-tracker begin";
const END = "# ai-code-tracker end";

export function moduleDirFromFileUrl(fileUrl, pathModule = path, fileUrlToPath = fileURLToPath) {
  return pathModule.dirname(fileUrlToPath(fileUrl));
}

function skillRelativeDir(repoRoot) {
  // Deterministic path: prefer .opencode if it exists, else .claude
  // This ensures git hooks reference the same path regardless of which
  // skill directory's install.js is running.
  const opencodeDir = path.join(repoRoot, ".opencode", "skills", "ai-code-tracker");
  if (fsSync.existsSync(opencodeDir)) return ".opencode/skills/ai-code-tracker";
  const claudeDir = path.join(repoRoot, ".claude", "skills", "ai-code-tracker");
  if (fsSync.existsSync(claudeDir)) return ".claude/skills/ai-code-tracker";
  // Fallback: derive from script location
  const scriptDir = moduleDirFromFileUrl(import.meta.url);
  const skillRoot = path.resolve(scriptDir, "..", "..");
  const rel = path.relative(repoRoot, skillRoot).replace(/\\/g, "/");
  if (rel.startsWith("..")) return ".opencode/skills/ai-code-tracker";
  return rel;
}

function hookScriptsForRepo(repoRoot) {
  const base = skillRelativeDir(repoRoot);
  return {
    "pre-commit": hookScript(`node --experimental-vm-modules "${base}/scripts/commit-stats.js" pre-commit`),
    "post-commit": hookScript(`node --experimental-vm-modules "${base}/scripts/commit-stats.js" post-commit`),
    "pre-push": hookScript(`node --experimental-vm-modules "${base}/scripts/commit-stats.js" pre-push`),
    "post-rewrite": hookScript(`node --experimental-vm-modules "${base}/scripts/commit-stats.js" prune`),
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
    `fi`,
  ].join("\n  ");
}

export async function runInstall(args = process.argv.slice(2), options = {}) {
  const mode = args.includes("--uninstall") ? "uninstall"
    : args.includes("--check") ? "check"
    : args.includes("--repair") ? "repair"
    : "install";
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
    const result = await checkInstall(repoRoot, hookScripts);
    if (!result.ok) {
      const details = [
        ...result.missing.map((m) => `missing: ${m}`),
        ...result.mismatches.map((m) => `content mismatch: ${m}`),
      ];
      await logInfo(repoRoot, "install.check", "not installed", { missing: result.missing, mismatches: result.mismatches, durationMs: timer.elapsedMs() });
      throw new Error(`ai-code-tracker check failed: ${details.join(", ")}`);
    }
    await logInfo(repoRoot, "install.check", "passed", { durationMs: timer.elapsedMs() });
    return result;
  }

  await installIntoRepo(repoRoot, hookScripts);
  const result = await checkInstall(repoRoot, hookScripts);
  await logInfo(repoRoot, `install.${mode}`, "complete", { ok: result.ok, missing: result.missing, mismatches: result.mismatches, durationMs: timer.elapsedMs() });
  return result;
}

export async function checkInstall(repoRoot, hookScripts = hookScriptsForRepo(repoRoot)) {
  const missing = [];
  const mismatches = [];

  const tool = await detectActiveTool();
  const isOpencode = tool === "opencode";
  const isClaude = tool === "claude";

  for (const hookName of ["pre-commit", "post-commit", "pre-push", "post-rewrite"]) {
    const hook = path.join(repoRoot, ".git", "hooks", hookName);
    if (!await hasEffectiveHook(hook, hookScripts[hookName])) missing.push(`${hookName} hook`);
  }

  const gitignorePath = path.join(repoRoot, ".gitignore");
  if (await exists(gitignorePath)) {
    const gitignoreContent = await fs.readFile(gitignorePath, "utf8");
    const existingLines = gitignoreContent.split(/\r?\n/);
    const missingLines = EXPECTED_GITIGNORE_LINES.filter((line) => !existingLines.includes(line));
    if (missingLines.length > 0) mismatches.push(`gitignore (missing: ${missingLines.join(", ")})`);
  } else {
    mismatches.push("gitignore (file not found)");
  }

  const cfg = configPath(repoRoot);
  if (!await exists(cfg)) {
    missing.push("tracker config");
  } else {
    try {
      const data = JSON.parse(await fs.readFile(cfg, "utf8"));
      if (!data.enabled) mismatches.push("tracker config");
    } catch {
      mismatches.push("tracker config");
    }
  }

  // opencode: check plugin + commands
  if (isOpencode || (!isOpencode && !isClaude)) {
    const pluginContent = expectedPluginContent();
    if (!await exists(opencodePluginPath(repoRoot))) {
      missing.push("opencode plugin");
    } else {
      const actual = await fs.readFile(opencodePluginPath(repoRoot), "utf8");
      if (actual.trimEnd() !== pluginContent.trimEnd()) mismatches.push("opencode plugin");
    }
    for (const file of OPENCODE_COMMAND_FILES) {
      const cmd = path.join(repoRoot, ".opencode", "commands", file);
      if (!await exists(cmd)) missing.push(`opencode command ${file}`);
    }
  }

  // Claude Code: check hooks + commands
  if (isClaude || (!isOpencode && !isClaude)) {
    if (!await hasClaudeHooks(repoRoot)) missing.push("Claude Code hooks");
    for (const file of CLAUDE_COMMAND_FILES) {
      const cmd = path.join(repoRoot, ".claude", "commands", file);
      if (!await exists(cmd)) missing.push(`Claude Code command ${file}`);
    }
  }

  return { ok: missing.length === 0 && mismatches.length === 0, missing, mismatches };
}

export async function installIntoRepo(repoRoot, hookScripts = hookScriptsForRepo(repoRoot)) {
  await ensureWritableRepo(repoRoot);

  const tool = await detectActiveTool();
  const isOpencode = tool === "opencode";
  const isClaude = tool === "claude";

  await logInfo(repoRoot, "install", "detected tool", { tool });

  // Shared: config + gitignore + git hooks
  if (!await exists(configPath(repoRoot))) {
    let installedVersion = "0.1.0";
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
      if (pkg.name === "ai-commit-statistic-skill") installedVersion = pkg.version || installedVersion;
    } catch {}
    await logInfo(repoRoot, "install", "writing tracker config");
    await atomicWriteJson(configPath(repoRoot), expectedConfigObject(installedVersion));
  }
  await updateGitignore(repoRoot);

  await logInfo(repoRoot, "install", "injecting git hooks", { hooks: ["pre-commit", "post-commit", "pre-push", "post-rewrite"] });
  await injectHook(repoRoot, "pre-commit", hookScripts["pre-commit"]);
  await injectHook(repoRoot, "post-commit", hookScripts["post-commit"]);
  await injectHook(repoRoot, "pre-push", hookScripts["pre-push"]);
  await injectHook(repoRoot, "post-rewrite", hookScripts["post-rewrite"]);

  // opencode: plugin + commands
  if (isOpencode) {
    await fs.mkdir(path.join(repoRoot, ".opencode", "plugins"), { recursive: true });
    await ensureOpencodePackage(repoRoot);
    await logInfo(repoRoot, "install", "writing opencode plugin");
    await writeExecutable(opencodePluginPath(repoRoot), expectedPluginContent());
    await logInfo(repoRoot, "install", "deploying opencode commands");
    await deployCommands(repoRoot, "opencode");
  }

  // Claude Code: hooks + commands
  if (isClaude) {
    await logInfo(repoRoot, "install", "injecting Claude Code hooks");
    await injectClaudeHooks(repoRoot);
    await logInfo(repoRoot, "install", "deploying Claude Code commands");
    await deployCommands(repoRoot, "claude");
  }

  // Unknown tool: install both
  if (!isOpencode && !isClaude) {
    await fs.mkdir(path.join(repoRoot, ".opencode", "plugins"), { recursive: true });
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

  // Remove git hook blocks
  for (const hookName of ["pre-commit", "post-commit", "pre-push", "post-rewrite"]) {
    const hook = path.join(repoRoot, ".git", "hooks", hookName);
    if (!await exists(hook)) continue;
    let content = await fs.readFile(hook, "utf8");
    content = removeExistingBlock(content).trimEnd();
    if (!content || content === "#!/bin/sh") {
      await fs.rm(hook, { force: true });
    } else {
      await fs.writeFile(hook, `${content}\n`, "utf8");
    }
  }

  // Remove Claude Code hooks
  await removeClaudeHooks(repoRoot);

  // Remove opencode plugin
  const plugin = opencodePluginPath(repoRoot);
  await fs.rm(plugin, { force: true });

  // Remove command files
  for (const file of OPENCODE_COMMAND_FILES) {
    await fs.rm(path.join(repoRoot, ".opencode", "commands", file), { force: true });
  }
  for (const file of CLAUDE_COMMAND_FILES) {
    await fs.rm(path.join(repoRoot, ".claude", "commands", file), { force: true });
  }

  // Remove config
  await fs.rm(configPath(repoRoot), { force: true });

  // Clean gitignore
  await cleanGitignore(repoRoot);

  // Clean AGENTS.md
  await cleanAgentsRule(repoRoot);
}

async function writeExecutable(destination, content) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content, "utf8");
  await fs.chmod(destination, 0o755);
}

async function injectHook(repoRoot, hookName, command) {
  const hook = path.join(repoRoot, ".git", "hooks", hookName);
  let content = "";
  if (await exists(hook)) content = await fs.readFile(hook, "utf8");
  if (await hasEffectiveHook(hook, command)) return;

  content = removeExistingBlock(content);

  if (!content.startsWith("#!")) content = `#!/bin/sh\n${content}`;
  const block = `\n${BEGIN}\n${command}\n${END}\n`;
  await fs.writeFile(hook, insertBeforeTerminalExec(content, block), "utf8");
  await fs.chmod(hook, 0o755);
}

function insertBeforeTerminalExec(content, block) {
  const execMatch = content.match(/^exec\b.*$/m);
  if (!execMatch || execMatch.index === undefined) {
    return `${content.trimEnd()}\n${block}`;
  }

  const before = content.slice(0, execMatch.index).trimEnd();
  const after = content.slice(execMatch.index).trimStart();
  return `${before}\n${block}${after.trimEnd()}\n`;
}

function removeExistingBlock(content) {
  const pattern = new RegExp(`\\n?${escapeRegExp(BEGIN)}\\n[\\s\\S]*?\\n${escapeRegExp(END)}\\n?`, "g");
  return content.replace(pattern, "\n");
}

async function hasEffectiveHook(hook, script) {
  let content;
  try {
    content = await fs.readFile(hook, "utf8");
  } catch {
    return false;
  }

  const blockIndex = content.indexOf(BEGIN);
  if (blockIndex === -1) return false;
  const endIndex = content.indexOf(END, blockIndex);
  if (endIndex === -1) return false;

  const blockBody = content.slice(blockIndex + BEGIN.length + 1, endIndex);
  if (blockBody.trimEnd() !== script.trimEnd()) return false;

  const execMatch = content.match(/^exec\b.*$/m);
  return !execMatch || execMatch.index === undefined || blockIndex < execMatch.index;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const EXPECTED_GITIGNORE_LINES = [
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
  ".ai-tracking/backup-pre-update/",
];

const CLAUDE_HOOK_MATCHER = "Edit|Write|NotebookEdit|Bash";

function claudeHookCommand() {
  return 'node --experimental-vm-modules ".claude/skills/ai-code-tracker/scripts/claude-code-hook.js"';
}

async function detectActiveTool() {
  // Check environment variables first (works on all platforms)
  if (process.env.CLAUDE_CODE || process.env.CLAUDE_CODE_SESSION) return "claude";
  if (process.env.OPENCODE_SESSION || process.env.CODEAGENT_SESSION) return "opencode";

  // Allow test override (same pattern as commit-stats.js)
  const envTree = process.env.AI_CODE_TRACKER_PROCESS_TREE;
  if (envTree !== undefined) {
    const lower = envTree.toLowerCase();
    if (/\bclaude\b/.test(lower)) return "claude";
    if (/\bopencode\b/.test(lower) || /\bcodeagent\b/.test(lower)) return "opencode";
    return "unknown";
  }

  // Check process tree
  if (process.platform === "win32") {
    const tree = await readWindowsProcessTree();
    if (/\bclaude\b/.test(tree)) return "claude";
    if (/\bopencode\b/.test(tree) || /\bcodeagent\b/.test(tree)) return "opencode";
  } else {
    // Unix: walk up from parent
    let pid = process.ppid;
    for (let i = 0; i < 10 && pid > 1; i++) {
      const stat = await readProcStat(pid) ?? await readPsStat(pid);
      if (!stat) break;
      const cmd = stat.command.toLowerCase();
      if (/\bclaude\b/.test(cmd)) return "claude";
      if (/\bopencode\b/.test(cmd) || /\bcodeagent\b/.test(cmd)) return "opencode";
      pid = stat.parentPid;
    }
  }

  return "unknown";
}

async function readWindowsProcessTree() {
  const script = `
$pidToRead = ${process.ppid}
for ($i = 0; $i -lt 10 -and $pidToRead -gt 0; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$pidToRead"
  if ($null -eq $p) { break }
  ($p.Name + " " + $p.CommandLine)
  $pidToRead = [int]$p.ParentProcessId
}`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 5000,
    });
    return stdout.toLowerCase();
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

async function readPsStat(pid) {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "ppid=", "-o", "comm=", "-p", String(pid)], {
      maxBuffer: 1024 * 1024,
      timeout: 3000,
    });
    const match = stdout.trim().match(/^(\d+)\s+(.+)$/u);
    if (!match) return null;
    return { parentPid: Number(match[1]), command: match[2] };
  } catch {
    return null;
  }
}

async function updateGitignore(repoRoot) {
  const gitignore = path.join(repoRoot, ".gitignore");
  let content = "";
  if (await exists(gitignore)) content = await fs.readFile(gitignore, "utf8");
  const additions = EXPECTED_GITIGNORE_LINES.filter((line) => !content.split(/\r?\n/).includes(line));
  if (additions.length === 0) return;
  const prefix = content && !content.endsWith("\n") ? "\n" : "";
  await fs.writeFile(gitignore, `${content}${prefix}${additions.join("\n")}\n`, "utf8");
}

async function ensureAgentsRule(repoRoot, tool) {
  const agents = path.join(repoRoot, "AGENTS.md");
  const rule = `## AI Code Tracker

Before modifying code in this repository, load the opencode skill \`ai-code-tracker\` and run its preflight check. If tracking is not installed or is broken, ask the user whether to install or repair it. If the user confirms, run the project-level install or repair script automatically, rerun preflight, and continue with code changes only after preflight passes.

After installing or repairing ai-code-tracker, tell the user to restart the current opencode session because project plugins are loaded at opencode startup.

When cherry-picking commits, always use \`git cherry-pick -x\` to preserve the source commit reference. This allows ai-code-tracker to copy the original AI line statistics into the cherry-picked commit's tracking record.
`;
  let content = "";
  if (await exists(agents)) content = await fs.readFile(agents, "utf8");
  if (content.includes("## AI Code Tracker")) {
    if (!content.includes("cherry-pick -x")) {
      await fs.writeFile(agents, `${content.trimEnd()}\n\nWhen cherry-picking commits, always use \`git cherry-pick -x\` to preserve the source commit reference. This allows ai-code-tracker to copy the original AI line statistics into the cherry-picked commit's tracking record.\n`, "utf8");
    }
    return;
  }
  const prefix = content && !content.endsWith("\n") ? "\n\n" : "";
  await fs.writeFile(agents, `${content}${prefix}${rule}`, "utf8");
}

async function ensureOpencodePackage(repoRoot) {
  const packageFile = path.join(repoRoot, ".opencode", "package.json");
  let data = {};
  try {
    data = JSON.parse(await fs.readFile(packageFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (data.type === "module") return;
  data.type = "module";
  await fs.writeFile(packageFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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
    source_repo: "https://github.com/yooocen/ai-commit-statistic-skill",
    check_updates: true,
    update_check_interval_hours: 24,
    last_update_check: null,
  };
}

const OPENCODE_COMMAND_FILES = ["ai-install.md", "ai-repair.md", "ai-check.md", "ai-stats.md", "ai-uninstall.md", "ai-update.md"];
const CLAUDE_COMMAND_FILES = ["ai-install.md", "ai-repair.md", "ai-check.md", "ai-stats.md", "ai-uninstall.md", "ai-update.md"];

async function deployCommands(repoRoot, tool) {
  const scriptDir = moduleDirFromFileUrl(import.meta.url);
  let commandsDir = path.join(path.dirname(scriptDir), "commands", tool);
  if (!await exists(commandsDir)) {
    const projectRoot = await gitRepoRoot(scriptDir);
    commandsDir = path.join(projectRoot, tool === "claude" ? ".claude" : ".opencode", "skills", "ai-code-tracker", "commands", tool);
  }
  const destDir = tool === "opencode"
    ? path.join(repoRoot, ".opencode", "commands")
    : path.join(repoRoot, ".claude", "commands");
  const files = tool === "opencode" ? OPENCODE_COMMAND_FILES : CLAUDE_COMMAND_FILES;

  await fs.mkdir(destDir, { recursive: true });
  for (const file of files) {
    const srcFile = path.join(commandsDir, file);
    if (await exists(srcFile)) {
      await fs.copyFile(srcFile, path.join(destDir, file));
    }
  }
}

async function ensureWritableRepo(repoRoot) {
  const gitDir = path.join(repoRoot, ".git");
  if (!await exists(gitDir)) throw new Error(`Not a git repository: ${repoRoot}`);
  await fs.access(repoRoot);
}

function claudeSettingsPath(repoRoot) {
  return path.join(repoRoot, ".claude", "settings.json");
}

async function injectClaudeHooks(repoRoot) {
  const settingsFile = claudeSettingsPath(repoRoot);
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });

  let settings = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  settings.hooks = settings.hooks ?? {};

  const expected = expectedClaudeHooks();
  for (const event of ["PreToolUse", "PostToolUse"]) {
    const hookDef = expected[event][0];
    const arr = settings.hooks[event] ?? [];
    const existing = arr.find((e) => e.matcher === hookDef.matcher);
    if (existing) {
      const hasCommand = existing.hooks?.some((h) => h.command === hookDef.hooks[0].command);
      if (!hasCommand) existing.hooks = [...(existing.hooks ?? []), ...hookDef.hooks];
    } else {
      arr.push(hookDef);
    }
    settings.hooks[event] = arr;
  }

  await fs.writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function expectedClaudeHooks() {
  const cmd = claudeHookCommand();
  return {
    PreToolUse: [
      {
        matcher: CLAUDE_HOOK_MATCHER,
        hooks: [{ type: "command", command: `${cmd} pre` }],
      },
    ],
    PostToolUse: [
      {
        matcher: CLAUDE_HOOK_MATCHER,
        hooks: [{ type: "command", command: `${cmd} post` }],
      },
    ],
  };
}

async function hasClaudeHooks(repoRoot) {
  const settingsFile = claudeSettingsPath(repoRoot);
  let settings;
  try {
    settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
  } catch {
    return false;
  }

  const expected = expectedClaudeHooks();
  for (const event of ["PreToolUse", "PostToolUse"]) {
    const hookDef = expected[event][0];
    const arr = settings.hooks?.[event];
    if (!Array.isArray(arr)) return false;
    const entry = arr.find((e) => e.matcher === hookDef.matcher);
    if (!entry) return false;
    const hasCommand = entry.hooks?.some((h) => h.command === hookDef.hooks[0].command);
    if (!hasCommand) return false;
  }
  return true;
}

async function removeClaudeHooks(repoRoot) {
  const settingsFile = claudeSettingsPath(repoRoot);
  let settings;
  try {
    settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
  } catch {
    return;
  }

  if (!settings.hooks) { await writeSettings(settingsFile, settings); return; }

  const cmds = [
    claudeHookCommand(),
    'node --experimental-vm-modules ".opencode/skills/ai-code-tracker/scripts/claude-code-hook.js"',
  ];
  for (const event of ["PreToolUse", "PostToolUse"]) {
    const arr = settings.hooks[event];
    if (!Array.isArray(arr)) continue;
    settings.hooks[event] = arr.filter((entry) => {
      if (entry.matcher !== CLAUDE_HOOK_MATCHER) return true;
      entry.hooks = (entry.hooks ?? []).filter((h) => !cmds.some((cmd) => h.command === `${cmd} pre` || h.command === `${cmd} post`));
      return entry.hooks.length > 0;
    });
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }

  await writeSettings(settingsFile, settings);
}

async function cleanGitignore(repoRoot) {
  const gitignore = path.join(repoRoot, ".gitignore");
  if (!await exists(gitignore)) return;
  let content = await fs.readFile(gitignore, "utf8");
  const lines = content.split(/\r?\n/);
  const cleaned = lines.filter((line) => !EXPECTED_GITIGNORE_LINES.includes(line));
  const result = cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  if (!result) {
    await fs.rm(gitignore, { force: true });
  } else {
    await fs.writeFile(gitignore, `${result}\n`, "utf8");
  }
}

async function cleanAgentsRule(repoRoot) {
  const agents = path.join(repoRoot, "AGENTS.md");
  if (!await exists(agents)) return;
  let content = await fs.readFile(agents, "utf8");
  const marker = "## AI Code Tracker";
  const idx = content.indexOf(marker);
  if (idx === -1) return;
  const before = content.slice(0, idx).trimEnd();
  const result = before.trimEnd();
  if (!result) {
    await fs.rm(agents, { force: true });
  } else {
    await fs.writeFile(agents, `${result}\n`, "utf8");
  }
}

async function writeSettings(settingsFile, settings) {
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  await fs.writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runInstall().then((result) => {
    if (result?.uninstalled) console.log("ai-code-tracker uninstalled");
    else if (result?.ok) console.log("ai-code-tracker installed");
  }).catch((error) => {
    console.error(`[ai-code-tracker] ${error.message}`);
    process.exitCode = 1;
  });
}
