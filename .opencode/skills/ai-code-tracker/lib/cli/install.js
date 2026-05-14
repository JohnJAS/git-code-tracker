#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitRepoRoot } from "../tracker/git.js";
import {
  configPath,
  opencodePluginPath,
} from "../tracker/paths.js";
import { atomicWriteJson } from "../tracker/lock.js";
import { logInfo, startTimer } from "../tracker/logger.js";

const BEGIN = "# ai-code-tracker begin";
const END = "# ai-code-tracker end";
const HOOK_SCRIPTS = {
  "pre-commit": hookScript('node ".opencode/skills/ai-code-tracker/scripts/commit-stats.js" pre-commit'),
  "post-commit": hookScript('node ".opencode/skills/ai-code-tracker/scripts/commit-stats.js" post-commit'),
  "pre-push": hookScript('node ".opencode/skills/ai-code-tracker/scripts/commit-stats.js" pre-push'),
};

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
  const mode = args.includes("--check") ? "check" : args.includes("--repair") ? "repair" : "install";
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = options.repoRoot ?? await gitRepoRoot(cwd);
  const timer = startTimer();

  await logInfo(repoRoot, `install.${mode}`, "enter");

  if (mode === "check") {
    const result = await checkInstall(repoRoot);
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

  await installIntoRepo(repoRoot);
  const result = await checkInstall(repoRoot);
  await logInfo(repoRoot, `install.${mode}`, "complete", { ok: result.ok, missing: result.missing, mismatches: result.mismatches, durationMs: timer.elapsedMs() });
  return result;
}

export async function checkInstall(repoRoot) {
  const missing = [];
  const mismatches = [];

  const pluginContent = expectedPluginContent();
  const configContent = expectedConfigContent();

  for (const [file, label, expected] of [
    [opencodePluginPath(repoRoot), "opencode plugin", pluginContent],
    [configPath(repoRoot), "tracker config", configContent],
  ]) {
    if (!await exists(file)) {
      missing.push(label);
      continue;
    }
    if (expected !== null) {
      const actual = await fs.readFile(file, "utf8");
      if (actual.trimEnd() !== expected.trimEnd()) mismatches.push(label);
    }
  }

  for (const hookName of ["pre-commit", "post-commit", "pre-push"]) {
    const hook = path.join(repoRoot, ".git", "hooks", hookName);
    if (!await hasEffectiveHook(hook, HOOK_SCRIPTS[hookName])) missing.push(`${hookName} hook`);
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

  if (!await hasClaudeHooks(repoRoot)) missing.push("Claude Code hooks");

  for (const file of COMMAND_FILES) {
    const opencodeCmd = path.join(repoRoot, ".opencode", "commands", file);
    if (!await exists(opencodeCmd)) missing.push(`opencode command ${file}`);
    const claudeCmd = path.join(repoRoot, ".claude", "commands", file);
    if (!await exists(claudeCmd)) missing.push(`Claude Code command ${file}`);
  }

  return { ok: missing.length === 0 && mismatches.length === 0, missing, mismatches };
}

export async function installIntoRepo(repoRoot) {
  await ensureWritableRepo(repoRoot);
  await fs.mkdir(path.join(repoRoot, ".opencode", "plugins"), { recursive: true });
  await ensureOpencodePackage(repoRoot);

  await logInfo(repoRoot, "install", "writing opencode plugin");
  await writeExecutable(opencodePluginPath(repoRoot), expectedPluginContent());

  await logInfo(repoRoot, "install", "writing tracker config");
  await atomicWriteJson(configPath(repoRoot), expectedConfigObject());

  await updateGitignore(repoRoot);

  await logInfo(repoRoot, "install", "injecting git hooks", { hooks: ["pre-commit", "post-commit", "pre-push"] });
  await injectHook(repoRoot, "pre-commit", HOOK_SCRIPTS["pre-commit"]);
  await injectHook(repoRoot, "post-commit", HOOK_SCRIPTS["post-commit"]);
  await injectHook(repoRoot, "pre-push", HOOK_SCRIPTS["pre-push"]);

  await logInfo(repoRoot, "install", "injecting Claude Code hooks");
  await injectClaudeHooks(repoRoot);

  await ensureAgentsRule(repoRoot);

  await logInfo(repoRoot, "install", "deploying commands");
  await deployCommands(repoRoot);
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
];

const CLAUDE_HOOK_MATCHER = "Edit|Write|NotebookEdit|Bash";
const CLAUDE_HOOK_COMMAND = 'node ".opencode/skills/ai-code-tracker/scripts/claude-code-hook.js"';

async function updateGitignore(repoRoot) {
  const gitignore = path.join(repoRoot, ".gitignore");
  let content = "";
  if (await exists(gitignore)) content = await fs.readFile(gitignore, "utf8");
  const additions = EXPECTED_GITIGNORE_LINES.filter((line) => !content.split(/\r?\n/).includes(line));
  if (additions.length === 0) return;
  const prefix = content && !content.endsWith("\n") ? "\n" : "";
  await fs.writeFile(gitignore, `${content}${prefix}${additions.join("\n")}\n`, "utf8");
}

async function ensureAgentsRule(repoRoot) {
  const agents = path.join(repoRoot, "AGENTS.md");
  const rule = `## AI Code Tracker

Before modifying code in this repository, load the opencode skill \`ai-code-tracker\` and run its preflight check. If tracking is not installed or is broken, ask the user whether to install or repair it. If the user confirms, run the project-level install or repair script automatically, rerun preflight, and continue with code changes only after preflight passes.

After installing or repairing ai-code-tracker, tell the user to restart the current opencode session because project plugins are loaded at opencode startup.
`;
  let content = "";
  if (await exists(agents)) content = await fs.readFile(agents, "utf8");
  if (content.includes("## AI Code Tracker")) {
    if (!content.includes("restart the current opencode session")) {
      await fs.writeFile(agents, `${content.trimEnd()}\n\nAfter installing or repairing ai-code-tracker, tell the user to restart the current opencode session because project plugins are loaded at opencode startup.\n`, "utf8");
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

function expectedConfigObject() {
  return {
    enabled: true,
    ignore: [".ai-tracking/**", ".git/**", "node_modules/**", "dist/**", "build/**"],
    count_blank_lines: false,
    tracking_commit_suffix: "[ai-tracking]",
    auto_tracking_commit: true,
    tracking_commit_ci_skip: false,
  };
}

function expectedConfigContent() {
  return `${JSON.stringify(expectedConfigObject(), null, 2)}\n`;
}

const COMMAND_FILES = ["ai-install.md", "ai-repair.md", "ai-check.md", "ai-stats.md"];

async function deployCommands(repoRoot) {
  const skillDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const commandsDir = path.join(skillDir, "commands");
  const targets = [
    { src: path.join(commandsDir, "opencode"), dest: path.join(repoRoot, ".opencode", "commands") },
    { src: path.join(commandsDir, "claude"), dest: path.join(repoRoot, ".claude", "commands") },
  ];
  for (const { src, dest } of targets) {
    await fs.mkdir(dest, { recursive: true });
    for (const file of COMMAND_FILES) {
      const srcFile = path.join(src, file);
      if (await exists(srcFile)) {
        await fs.copyFile(srcFile, path.join(dest, file));
      }
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
  return {
    PreToolUse: [
      {
        matcher: CLAUDE_HOOK_MATCHER,
        hooks: [{ type: "command", command: `${CLAUDE_HOOK_COMMAND} pre` }],
      },
    ],
    PostToolUse: [
      {
        matcher: CLAUDE_HOOK_MATCHER,
        hooks: [{ type: "command", command: `${CLAUDE_HOOK_COMMAND} post` }],
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
    if (result?.ok) console.log("ai-code-tracker installed");
  }).catch((error) => {
    console.error(`[ai-code-tracker] ${error.message}`);
    process.exitCode = 1;
  });
}
