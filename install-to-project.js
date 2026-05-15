#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { access } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const targetRoot = path.resolve(process.argv[2] ?? process.cwd());
const sourceSkill = path.join(sourceRoot, ".opencode", "skills", "ai-code-tracker");
const targetSkill = path.join(targetRoot, ".opencode", "skills", "ai-code-tracker");

let _gitPath = null;

async function findGit() {
  if (_gitPath) return _gitPath;

  if (process.platform !== "win32") {
    _gitPath = "git";
    return _gitPath;
  }

  const candidates = [];
  const envVars = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LocalAppData, process.env.ProgramW6432];
  for (const base of envVars) {
    if (!base) continue;
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

await assertGitRepo(targetRoot);
await fs.mkdir(path.dirname(targetSkill), { recursive: true });
await fs.rm(targetSkill, { recursive: true, force: true });
await fs.cp(sourceSkill, targetSkill, { recursive: true });
await execFileAsync("node", ["--experimental-vm-modules", path.join(targetSkill, "scripts", "install.js")], { cwd: targetRoot });

console.log(`ai-code-tracker installed into ${targetRoot}`);

async function assertGitRepo(cwd) {
  try {
    const gitBin = await findGit();
    await execFileAsync(gitBin, ["rev-parse", "--show-toplevel"], { cwd });
  } catch {
    throw new Error(`Target is not a git repository: ${cwd}`);
  }
}
