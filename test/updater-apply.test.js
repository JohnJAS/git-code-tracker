import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { applyReleaseFiles } from "../src/tracker/updater.js";

const SCRIPT_FILES = ["ai-update.js", "install.js", "commit-stats.js", "claude-code-hook.js", "ai-code-stats.js", "opencode-plugin.js"];

async function setup() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-apply-"));
  const skillDest = path.join(repoRoot, ".opencode", "skills", "ai-code-tracker");
  const claudeDest = path.join(repoRoot, ".claude", "skills", "ai-code-tracker");
  const cacDest = path.join(repoRoot, ".cac", "skills", "ai-code-tracker");
  for (const dir of [skillDest, claudeDest, cacDest]) {
    await fs.mkdir(path.join(dir, "lib", "tracker"), { recursive: true });
    await fs.writeFile(path.join(dir, "lib", "tracker", "old.js"), "// stale", "utf8");
    await fs.mkdir(path.join(dir, "scripts"), { recursive: true });
  }
  const extractDir = path.join(repoRoot, ".extract");
  const srcSkill = path.join(extractDir, ".opencode", "skills", "ai-code-tracker");
  await fs.mkdir(path.join(srcSkill, "scripts"), { recursive: true });
  await fs.mkdir(path.join(srcSkill, "lib", "tracker"), { recursive: true });
  await fs.mkdir(path.join(srcSkill, "commands"), { recursive: true });
  for (const f of SCRIPT_FILES) {
    await fs.writeFile(path.join(srcSkill, "scripts", f), `// ${f}`, "utf8");
  }
  await fs.writeFile(path.join(srcSkill, "lib", "index.js"), "// lib index", "utf8");
  await fs.writeFile(path.join(srcSkill, "lib", "tracker", "updater.js"), "// updater", "utf8");
  await fs.writeFile(path.join(srcSkill, "commands", "cmd.md"), "# cmd", "utf8");
  await fs.writeFile(path.join(srcSkill, "SKILL.md"), "# skill", "utf8");
  return { repoRoot, skillDest, claudeDest, cacDest, extractDir };
}

test("applyReleaseFiles replaces stale lib/ on .opencode side", async () => {
  const { repoRoot, skillDest, extractDir } = await setup();
  await applyReleaseFiles(repoRoot, extractDir);
  await assert.rejects(() => fs.stat(path.join(skillDest, "lib", "tracker", "old.js")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(skillDest, "lib", "index.js"), "utf8"), "// lib index");
});

test("applyReleaseFiles replaces stale lib/ on .claude side", async () => {
  const { repoRoot, claudeDest, extractDir } = await setup();
  await applyReleaseFiles(repoRoot, extractDir);
  await assert.rejects(() => fs.stat(path.join(claudeDest, "lib", "tracker", "old.js")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(claudeDest, "lib", "index.js"), "utf8"), "// lib index");
});

test("applyReleaseFiles copies wrappers", async () => {
  const { repoRoot, skillDest, extractDir } = await setup();
  await applyReleaseFiles(repoRoot, extractDir);
  for (const f of ["commit-stats.js", "install.js"]) {
    assert.equal(await fs.readFile(path.join(skillDest, "scripts", f), "utf8"), `// ${f}`);
  }
});

test("applyReleaseFiles syncs lib/ to .claude side", async () => {
  const { repoRoot, claudeDest, extractDir } = await setup();
  await applyReleaseFiles(repoRoot, extractDir);
  assert.equal(await fs.readFile(path.join(claudeDest, "lib", "index.js"), "utf8"), "// lib index");
});

test("applyReleaseFiles syncs lib/ to .cac side", async () => {
  const { repoRoot, cacDest, extractDir } = await setup();
  await applyReleaseFiles(repoRoot, extractDir);
  await assert.rejects(() => fs.stat(path.join(cacDest, "lib", "tracker", "old.js")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(cacDest, "lib", "index.js"), "utf8"), "// lib index");
});
