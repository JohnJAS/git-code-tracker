#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const targetRoot = path.resolve(process.argv[2] ?? process.cwd());
const sourceSkill = path.join(sourceRoot, ".opencode", "skills", "ai-code-tracker");
const targetSkill = path.join(targetRoot, ".opencode", "skills", "ai-code-tracker");

await assertGitRepo(targetRoot);
await fs.mkdir(path.dirname(targetSkill), { recursive: true });
await fs.rm(targetSkill, { recursive: true, force: true });
await fs.cp(sourceSkill, targetSkill, { recursive: true });
await execFileAsync("node", [path.join(targetSkill, "scripts", "install.js")], { cwd: targetRoot });

console.log(`ai-code-tracker installed into ${targetRoot}`);

async function assertGitRepo(cwd) {
  try {
    await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
  } catch {
    throw new Error(`Target is not a git repository: ${cwd}`);
  }
}
