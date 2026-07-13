#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { access } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceOpenSkill = path.join(sourceRoot, ".opencode", "skills", "ai-code-tracker");
const sourceClaudeSkill = path.join(sourceRoot, ".claude", "skills", "ai-code-tracker");
const sourceCacSkill = path.join(sourceRoot, ".cac", "skills", "ai-code-tracker");

let _gitPath = null;

async function findGit() {
  if (_gitPath) { return _gitPath; }

  if (process.platform !== "win32") {
    _gitPath = "git";
    return _gitPath;
  }

  const candidates = [];
  const envVars = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LocalAppData, process.env.ProgramW6432];
  for (const base of envVars) {
    if (!base) { continue; }
    candidates.push(path.join(base, "Git", "cmd", "git.exe"));
    candidates.push(path.join(base, "Git", "bin", "git.exe"));
  }
  candidates.push(path.join("C:", "Program Files", "Git", "cmd", "git.exe"));
  candidates.push(path.join("C:", "Program Files", "Git", "bin", "git.exe"));
  candidates.push(path.join("C:", "Program Files (x86)", "Git", "cmd", "git.exe"));

  for (const p of candidates) {
    try {
      await access(p);
      _gitPath = p;
      return _gitPath;
    } catch {}
  }

  _gitPath = "git";
  return _gitPath;
}

async function copySkill(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rm(target, { recursive: true, force: true });
  await fs.cp(source, target, { recursive: true });
}

try {
  const { targetRoot, platform } = await parseArgs(process.argv.slice(2));
  const platformTargets = platform === "all" ? ["opencode", "claude", "codeagent-cli"] : [platform];
  const skills = platformConfig(targetRoot);

  await assertGitRepo(targetRoot);

  for (const selected of platformTargets) {
    await copySkill(skills[selected].source, skills[selected].target);
  }

  const installPlatform = platform === "all" ? "opencode" : platform;
  await execFileAsync(
    "node",
    ["--experimental-vm-modules", path.join(skills[installPlatform].target, "scripts", "install.js")],
    {
      cwd: targetRoot,
      env: {
        ...process.env,
        AI_CODE_TRACKER_PROCESS_TREE: platform === "all" ? "unknown" : platform,
      },
    },
  );
  console.log(`ai-code-tracker installed into ${targetRoot} for ${platform}`);
} catch (error) {
  console.error(`[ai-code-tracker] ${error.message}`);
  process.exitCode = 1;
}

async function parseArgs(args) {
  let targetArg = null;
  let platformArg = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--platform") {
      platformArg = args[++i];
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      throw new Error("Usage: node install-to-project.js <target-project> --platform <opencode|claude|codeagent-cli|all>");
    }
    if (!targetArg) {
      targetArg = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  const targetRoot = path.resolve(targetArg ?? process.cwd());
  const platform = normalizePlatform(platformArg) ?? await detectPlatform(targetRoot);
  if (!platform) {
    throw new Error("Unable to determine target platform. Re-run with --platform <opencode|claude|codeagent-cli|all>.");
  }

  return { targetRoot, platform };
}

function platformConfig(targetRoot) {
  const targetOpenSkill = path.join(targetRoot, ".opencode", "skills", "ai-code-tracker");
  const targetClaudeSkill = path.join(targetRoot, ".claude", "skills", "ai-code-tracker");
  const targetCacSkill = path.join(targetRoot, ".cac", "skills", "ai-code-tracker");

  return {
    opencode: {
      source: sourceOpenSkill,
      target: targetOpenSkill,
    },
    claude: {
      source: sourceClaudeSkill,
      target: targetClaudeSkill,
    },
    "codeagent-cli": {
      source: sourceCacSkill,
      target: targetCacSkill,
    },
  };
}

function normalizePlatform(value) {
  if (!value) { return null; }
  const normalized = value.toLowerCase();
  if (normalized === "opencode") { return "opencode"; }
  if (normalized === "claude" || normalized === "claude-code") { return "claude"; }
  if (normalized === "codeagent-cli" || normalized === "codeagent" || normalized === "cac") { return "codeagent-cli"; }
  if (normalized === "all") { return "all"; }
  throw new Error(`Unsupported platform: ${value}. Expected opencode, claude, codeagent-cli, or all.`);
}

async function detectPlatform(targetRoot) {
  const envPlatform = normalizePlatform(
    process.env.AGENT_SEED_PLATFORM ||
      process.env.AI_AGENT_PLATFORM ||
      (process.env.CLAUDE_CODE || process.env.CLAUDE_CODE_SESSION ? "claude" : "") ||
      (process.env.CAC_SESSION || process.env.CODEAGENT_CLI || process.env.CODEAGENT_SESSION ? "codeagent-cli" : "") ||
      (process.env.OPENCODE_SESSION ? "opencode" : ""),
  );
  if (envPlatform) { return envPlatform; }

  const candidates = [];
  for (const [platform, marker] of [
    ["opencode", ".opencode"],
    ["claude", ".claude"],
    ["codeagent-cli", ".cac"],
  ]) {
    try {
      await access(path.join(targetRoot, marker));
      candidates.push(platform);
    } catch {}
  }
  return candidates.length === 1 ? candidates[0] : null;
}

async function assertGitRepo(cwd) {
  try {
    const gitBin = await findGit();
    await execFileAsync(gitBin, ["rev-parse", "--show-toplevel"], { cwd });
  } catch {
    throw new Error(`Target is not a git repository: ${cwd}`);
  }
}
