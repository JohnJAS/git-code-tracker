import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { checkInstall, installIntoRepo } from "../src/cli/install.js";

async function fakeRepo() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-install-"));
  await fs.mkdir(path.join(repoRoot, ".git", "hooks"), { recursive: true });
  return repoRoot;
}

test("installer creates project-local files and hooks", async () => {
  const repoRoot = await fakeRepo();

  await installIntoRepo(repoRoot);

  assert.equal((await checkInstall(repoRoot)).ok, true);
  const hook = await fs.readFile(path.join(repoRoot, ".git", "hooks", "pre-commit"), "utf8");
  assert.match(hook, /ai-code-tracker begin/);
  assert.match(hook, /\.opencode\/skills\/ai-code-tracker\/scripts\/commit-stats\.js/);
  assert.match(await fs.readFile(path.join(repoRoot, ".git", "hooks", "pre-push"), "utf8"), /pre-push/);
  assert.match(await fs.readFile(path.join(repoRoot, ".gitignore"), "utf8"), /pending-lines\.json/);
  assert.match(await fs.readFile(path.join(repoRoot, ".gitignore"), "utf8"), /errors\.log/);
  assert.match(await fs.readFile(path.join(repoRoot, ".gitignore"), "utf8"), /\.ai-tracking\/archive\//);
  assert.match(await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8"), /AI_CODE_TRACKER_AI_COMMIT=1 git commit/);
  await assert.rejects(fs.access(path.join(os.homedir(), ".config", "opencode", "plugins", "ai-code-tracker.js", "not-real")));
});

test("installer is idempotent", async () => {
  const repoRoot = await fakeRepo();
  await installIntoRepo(repoRoot);
  await installIntoRepo(repoRoot);

  const hook = await fs.readFile(path.join(repoRoot, ".git", "hooks", "pre-commit"), "utf8");
  assert.equal(hook.match(/ai-code-tracker begin/g).length, 1);
});

test("installer puts tracker before terminal exec hooks", async () => {
  const repoRoot = await fakeRepo();
  const hookPath = path.join(repoRoot, ".git", "hooks", "pre-commit");
  await fs.writeFile(hookPath, "#!/bin/sh\nexec prek hook-impl --hook-type=pre-commit -- \"$@\"\n", "utf8");

  await installIntoRepo(repoRoot);

  const hook = await fs.readFile(hookPath, "utf8");
  assert.equal((await checkInstall(repoRoot)).ok, true);
  assert.ok(hook.indexOf("ai-code-tracker begin") < hook.indexOf("exec prek"));
});

test("installer repairs tracker block after terminal exec hooks", async () => {
  const repoRoot = await fakeRepo();
  const hookPath = path.join(repoRoot, ".git", "hooks", "pre-commit");
  await fs.writeFile(
    hookPath,
    [
      "#!/bin/sh",
      "exec prek hook-impl --hook-type=pre-commit -- \"$@\"",
      "",
      "# ai-code-tracker begin",
      "node \".ai-tracking/bin/commit-stats.js\" pre-commit",
      "# ai-code-tracker end",
      "",
    ].join("\n"),
    "utf8",
  );

  assert.equal((await checkInstall(repoRoot)).ok, false);

  await installIntoRepo(repoRoot);

  const hook = await fs.readFile(hookPath, "utf8");
  assert.equal((hook.match(/ai-code-tracker begin/g) ?? []).length, 1);
  assert.ok(hook.indexOf("ai-code-tracker begin") < hook.indexOf("exec prek"));
  assert.doesNotMatch(hook, /\.ai-tracking\/bin\/commit-stats\.js/);
  assert.match(hook, /\.opencode\/skills\/ai-code-tracker\/scripts\/commit-stats\.js/);
});

test("installer repairs old hook command that depends on .ai-tracking/bin", async () => {
  const repoRoot = await fakeRepo();
  const hookPath = path.join(repoRoot, ".git", "hooks", "post-commit");
  await fs.writeFile(
    hookPath,
    [
      "#!/bin/sh",
      "",
      "# ai-code-tracker begin",
      "node \".ai-tracking/bin/commit-stats.js\" post-commit",
      "# ai-code-tracker end",
      "",
    ].join("\n"),
    "utf8",
  );

  assert.equal((await checkInstall(repoRoot)).ok, false);

  await installIntoRepo(repoRoot);

  const hook = await fs.readFile(hookPath, "utf8");
  assert.doesNotMatch(hook, /\.ai-tracking\/bin\/commit-stats\.js/);
  assert.match(hook, /\.opencode\/skills\/ai-code-tracker\/scripts\/commit-stats\.js/);
});

test("installer updates existing AI Code Tracker AGENTS rule", async () => {
  const repoRoot = await fakeRepo();
  await fs.writeFile(path.join(repoRoot, "AGENTS.md"), "## AI Code Tracker\n\nBefore modifying code, run preflight.\n", "utf8");

  await installIntoRepo(repoRoot);

  assert.match(await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8"), /AI_CODE_TRACKER_AI_COMMIT=1 git commit/);
});
