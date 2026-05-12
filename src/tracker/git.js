import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function git(args, options = {}) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
  });
  return stdout.trimEnd();
}

export async function gitRaw(args, options = {}) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
  });
  return stdout;
}

export async function gitRepoRoot(cwd = process.cwd()) {
  return git(["rev-parse", "--show-toplevel"], { cwd });
}
