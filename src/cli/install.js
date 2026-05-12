#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { gitRepoRoot } from "../tracker/git.js";
import {
  configPath,
  opencodePluginPath,
} from "../tracker/paths.js";
import { atomicWriteJson } from "../tracker/lock.js";
import { logInfo, startTimer } from "../tracker/logger.js";

const BEGIN = "# ai-code-tracker begin";
const END = "# ai-code-tracker end";
const HOOK_COMMANDS = {
  "pre-commit": 'node ".opencode/skills/ai-code-tracker/scripts/commit-stats.js" pre-commit',
  "post-commit": 'node ".opencode/skills/ai-code-tracker/scripts/commit-stats.js" post-commit',
  "pre-push": 'node ".opencode/skills/ai-code-tracker/scripts/commit-stats.js" pre-push',
};

export async function runInstall(args = process.argv.slice(2), options = {}) {
  const mode = args.includes("--check") ? "check" : args.includes("--repair") ? "repair" : "install";
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = options.repoRoot ?? await gitRepoRoot(cwd);
  const timer = startTimer();

  await logInfo(repoRoot, `install.${mode}`, "enter");

  if (mode === "check") {
    const result = await checkInstall(repoRoot);
    if (!result.ok) {
      await logInfo(repoRoot, "install.check", "not installed", { missing: result.missing, durationMs: timer.elapsedMs() });
      throw new Error(`ai-code-tracker is not installed: ${result.missing.join(", ")}`);
    }
    await logInfo(repoRoot, "install.check", "passed", { durationMs: timer.elapsedMs() });
    return result;
  }

  await installIntoRepo(repoRoot);
  const result = await checkInstall(repoRoot);
  await logInfo(repoRoot, `install.${mode}`, "complete", { ok: result.ok, missing: result.missing, durationMs: timer.elapsedMs() });
  return result;
}

export async function checkInstall(repoRoot) {
  const checks = [
    [opencodePluginPath(repoRoot), "opencode plugin"],
    [configPath(repoRoot), "tracker config"],
  ];

  const missing = [];
  for (const [file, label] of checks) {
    if (!await exists(file)) missing.push(label);
  }

  for (const hookName of ["pre-commit", "post-commit", "pre-push"]) {
    const hook = path.join(repoRoot, ".git", "hooks", hookName);
    if (!await hasEffectiveHook(hook, HOOK_COMMANDS[hookName])) missing.push(`${hookName} hook`);
  }

  return { ok: missing.length === 0, missing };
}

export async function installIntoRepo(repoRoot) {
  await ensureWritableRepo(repoRoot);
  await fs.mkdir(path.join(repoRoot, ".opencode", "plugins"), { recursive: true });
  await ensureOpencodePackage(repoRoot);

  await logInfo(repoRoot, "install", "writing opencode plugin");
  await writeExecutable(
    opencodePluginPath(repoRoot),
    'export { AiCodeTrackerPlugin } from "../skills/ai-code-tracker/scripts/opencode-plugin.js";\n',
  );

  await logInfo(repoRoot, "install", "writing tracker config");
  await atomicWriteJson(configPath(repoRoot), {
    enabled: true,
    ignore: [".ai-tracking/**", ".git/**", "node_modules/**", "dist/**", "build/**"],
    count_blank_lines: false,
    tracking_commit_suffix: "[ai-tracking]",
    auto_tracking_commit: true,
    tracking_commit_ci_skip: false,
  });

  await updateGitignore(repoRoot);

  await logInfo(repoRoot, "install", "injecting git hooks", { hooks: ["pre-commit", "post-commit", "pre-push"] });
  await injectHook(repoRoot, "pre-commit", HOOK_COMMANDS["pre-commit"]);
  await injectHook(repoRoot, "post-commit", HOOK_COMMANDS["post-commit"]);
  await injectHook(repoRoot, "pre-push", HOOK_COMMANDS["pre-push"]);
  await ensureAgentsRule(repoRoot);
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

async function hasEffectiveHook(hook, command) {
  let content;
  try {
    content = await fs.readFile(hook, "utf8");
  } catch {
    return false;
  }

  const blockIndex = content.indexOf(BEGIN);
  if (blockIndex === -1) return false;
  const endIndex = content.indexOf(END, blockIndex);
  const block = content.slice(blockIndex, endIndex === -1 ? undefined : endIndex);
  if (!block.includes(command)) return false;

  const execMatch = content.match(/^exec\b.*$/m);
  return !execMatch || execMatch.index === undefined || blockIndex < execMatch.index;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function updateGitignore(repoRoot) {
  const gitignore = path.join(repoRoot, ".gitignore");
  const lines = [
    ".ai-tracking/pending-lines.json",
    ".ai-tracking/pending-commit.json",
    ".ai-tracking/tracking-message.txt",
    ".ai-tracking/errors.log",
    ".ai-tracking/plugin.log",
    ".ai-tracking/plugin.log.*",
    ".ai-tracking/*.lock",
    ".ai-tracking/archive/",
  ];
  let content = "";
  if (await exists(gitignore)) content = await fs.readFile(gitignore, "utf8");
  const additions = lines.filter((line) => !content.split(/\r?\n/).includes(line));
  if (additions.length === 0) return;
  const prefix = content && !content.endsWith("\n") ? "\n" : "";
  await fs.writeFile(gitignore, `${content}${prefix}${additions.join("\n")}\n`, "utf8");
}

async function ensureAgentsRule(repoRoot) {
  const agents = path.join(repoRoot, "AGENTS.md");
  const rule = `## AI Code Tracker

Before modifying code in this repository, load the opencode skill \`ai-code-tracker\` and run its preflight check. If tracking is not installed or is broken, ask the user whether to install or repair it. If the user confirms, run the project-level install or repair script automatically, rerun preflight, and continue with code changes only after preflight passes.

After installing or repairing ai-code-tracker, tell the user to restart the current opencode session because project plugins are loaded at opencode startup.

If you create a user-requested commit from opencode, you MUST mark it as AI-created by running \`AI_CODE_TRACKER_AI_COMMIT=1 git commit ...\`. Do not set this variable for commits the user creates directly in their own terminal.
`;
  let content = "";
  if (await exists(agents)) content = await fs.readFile(agents, "utf8");
  if (content.includes("## AI Code Tracker")) {
    const additions = [];
    if (!content.includes("restart the current opencode session")) {
      additions.push("After installing or repairing ai-code-tracker, tell the user to restart the current opencode session because project plugins are loaded at opencode startup.");
    }
    if (!content.includes("AI_CODE_TRACKER_AI_COMMIT=1 git commit")) {
      additions.push("If you create a user-requested commit from opencode, you MUST mark it as AI-created by running `AI_CODE_TRACKER_AI_COMMIT=1 git commit ...`. Do not set this variable for commits the user creates directly in their own terminal.");
    }
    if (additions.length === 0) return;
    await fs.writeFile(agents, `${content.trimEnd()}\n\n${additions.join("\n\n")}\n`, "utf8");
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

async function ensureWritableRepo(repoRoot) {
  const gitDir = path.join(repoRoot, ".git");
  if (!await exists(gitDir)) throw new Error(`Not a git repository: ${repoRoot}`);
  await fs.access(repoRoot);
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
