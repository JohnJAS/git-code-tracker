import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { applyReleaseFiles } from "../src/tracker/updater.js";

async function setup() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-apply-"));
  const skillDest = path.join(repoRoot, ".opencode", "skills", "ai-code-tracker");
  const claudeDest = path.join(repoRoot, ".claude", "skills", "ai-code-tracker");
  for (const dir of [skillDest, claudeDest]) {
    await fs.mkdir(path.join(dir, "lib", "tracker"), { recursive: true });
    await fs.writeFile(path.join(dir, "lib", "tracker", "old.js"), "// stale", "utf8");
    await fs.mkdir(path.join(dir, "scripts"), { recursive: true });
  }
  const extractDir = path.join(repoRoot, ".extract");
  const srcSkill = path.join(extractDir, ".opencode", "skills", "ai-code-tracker");
  await fs.mkdir(path.join(srcSkill, "scripts"), { recursive: true });
  await fs.mkdir(path.join(srcSkill, "commands"), { recursive: true });
  for (const f of ["ai-update.js","install.js","commit-stats.js","claude-code-hook.js","ai-code-stats.js","opencode-plugin.js","bundle.js"]) {
    await fs.writeFile(path.join(srcSkill, "scripts", f), `// ${f}`, "utf8");
  }
  await fs.writeFile(path.join(srcSkill, "commands", "cmd.md"), "# cmd", "utf8");
  await fs.writeFile(path.join(srcSkill, "SKILL.md"), "# skill", "utf8");
  return { repoRoot, skillDest, claudeDest, extractDir };
}

test("applyReleaseFiles removes stale lib/ on .opencode side", async () => {
  const { repoRoot, skillDest, extractDir } = await setup();
  await applyReleaseFiles(repoRoot, extractDir);
  await assert.rejects(() => fs.stat(path.join(skillDest, "lib")), { code: "ENOENT" });
});

test("applyReleaseFiles removes stale lib/ on .claude side", async () => {
  const { repoRoot, claudeDest, extractDir } = await setup();
  await applyReleaseFiles(repoRoot, extractDir);
  await assert.rejects(() => fs.stat(path.join(claudeDest, "lib")), { code: "ENOENT" });
});

test("applyReleaseFiles copies bundle.js and wrappers", async () => {
  const { repoRoot, skillDest, extractDir } = await setup();
  await applyReleaseFiles(repoRoot, extractDir);
  for (const f of ["bundle.js", "commit-stats.js", "install.js"]) {
    assert.equal(await fs.readFile(path.join(skillDest, "scripts", f), "utf8"), `// ${f}`);
  }
});

test("applyReleaseFiles syncs bundle.js to .claude side", async () => {
  const { repoRoot, claudeDest, extractDir } = await setup();
  await applyReleaseFiles(repoRoot, extractDir);
  assert.equal(await fs.readFile(path.join(claudeDest, "scripts", "bundle.js"), "utf8"), "// bundle.js");
});
