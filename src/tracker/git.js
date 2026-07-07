import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
    } catch {}
  }

  _gitPath = "git";
  return _gitPath;
}

async function execGit(args, options = {}) {
  const gitBin = await findGit();
  return execFileAsync(gitBin, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
  });
}

export async function git(args, options = {}) {
  const { stdout } = await execGit(args, options);
  return stdout.trimEnd();
}

export async function gitRaw(args, options = {}) {
  const { stdout } = await execGit(args, options);
  return stdout;
}

export async function gitRepoRoot(cwd = process.cwd()) {
  return git(["rev-parse", "--show-toplevel"], { cwd });
}
