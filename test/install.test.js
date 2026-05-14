import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { checkInstall, installIntoRepo } from "../src/cli/install.js";
import { configPath, opencodePluginPath } from "../src/tracker/paths.js";

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
  assert.match(await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8"), /ai-code-tracker/);
  assert.doesNotMatch(await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8"), /AI_CODE_TRACKER_AI_COMMIT/);
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

  assert.match(await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8"), /ai-code-tracker/);
  assert.doesNotMatch(await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8"), /AI_CODE_TRACKER_AI_COMMIT/);
});

test("checkInstall detects tampered plugin file", async () => {
  const repoRoot = await fakeRepo();
  await installIntoRepo(repoRoot);

  assert.equal((await checkInstall(repoRoot)).ok, true);

  // Tamper with the Claude Code settings to remove tracker hooks (always checked when tool=claude)
  const settingsFile = path.join(repoRoot, ".claude", "settings.json");
  const settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
  settings.hooks.PreToolUse = [];
  await fs.writeFile(settingsFile, JSON.stringify(settings), "utf8");

  const result = await checkInstall(repoRoot);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("Claude Code hooks"), `expected "Claude Code hooks" in missing, got: ${JSON.stringify(result.missing)}`);
});

test("checkInstall detects tampered config file", async () => {
  const repoRoot = await fakeRepo();
  await installIntoRepo(repoRoot);

  await fs.writeFile(configPath(repoRoot), JSON.stringify({ enabled: false }), "utf8");

  const result = await checkInstall(repoRoot);
  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, ["tracker config"]);
});

test("checkInstall reports both missing and mismatched files", async () => {
  const repoRoot = await fakeRepo();
  await installIntoRepo(repoRoot);

  // Remove config (missing) and tamper gitignore (mismatched) — both always checked
  await fs.rm(configPath(repoRoot));
  await fs.writeFile(path.join(repoRoot, ".gitignore"), "node_modules/\n", "utf8");

  const result = await checkInstall(repoRoot);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("tracker config"), `expected "tracker config" in missing, got: ${JSON.stringify(result.missing)}`);
  assert.ok(result.mismatches.some((m) => m.startsWith("gitignore")), `expected gitignore mismatch, got: ${JSON.stringify(result.mismatches)}`);
});

test("checkInstall detects missing gitignore entries", async () => {
  const repoRoot = await fakeRepo();
  await installIntoRepo(repoRoot);

  await fs.writeFile(path.join(repoRoot, ".gitignore"), "node_modules/\n", "utf8");

  const result = await checkInstall(repoRoot);
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((m) => m.startsWith("gitignore")));
});

test("checkInstall passes when gitignore has all expected lines", async () => {
  const repoRoot = await fakeRepo();
  await installIntoRepo(repoRoot);

  assert.equal((await checkInstall(repoRoot)).ok, true);
});

test("installer injects Claude Code hooks into settings.json", async () => {
  const repoRoot = await fakeRepo();
  await installIntoRepo(repoRoot);

  const settings = JSON.parse(await fs.readFile(path.join(repoRoot, ".claude", "settings.json"), "utf8"));
  const preHook = settings.hooks.PreToolUse.find((e) => e.matcher === "Edit|Write|NotebookEdit|Bash");
  assert.ok(preHook);
  assert.match(preHook.hooks[0].command, /claude-code-hook\.js.*pre/);

  const postHook = settings.hooks.PostToolUse.find((e) => e.matcher === "Edit|Write|NotebookEdit|Bash");
  assert.ok(postHook);
  assert.match(postHook.hooks[0].command, /claude-code-hook\.js.*post/);
});

test("installer is idempotent for Claude Code hooks", async () => {
  const repoRoot = await fakeRepo();
  await installIntoRepo(repoRoot);
  await installIntoRepo(repoRoot);

  const settings = JSON.parse(await fs.readFile(path.join(repoRoot, ".claude", "settings.json"), "utf8"));
  const preEntries = settings.hooks.PreToolUse.filter((e) => e.matcher === "Edit|Write|NotebookEdit|Bash");
  assert.equal(preEntries.length, 1);
  assert.equal(preEntries[0].hooks.length, 1);
});

test("installer merges with existing settings.json", async () => {
  const repoRoot = await fakeRepo();
  await fs.mkdir(path.join(repoRoot, ".claude"), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, ".claude", "settings.json"),
    JSON.stringify({
      permissions: { allow: ["Bash(git *)"], deny: [] },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "check.sh" }] }],
      },
    }),
    "utf8",
  );

  await installIntoRepo(repoRoot);

  const settings = JSON.parse(await fs.readFile(path.join(repoRoot, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(settings.permissions.allow, ["Bash(git *)"]);

  const bashHook = settings.hooks.PreToolUse.find((e) => e.matcher === "Bash");
  assert.ok(bashHook);
  assert.equal(bashHook.hooks[0].command, "check.sh");

  const trackerHook = settings.hooks.PreToolUse.find((e) => e.matcher === "Edit|Write|NotebookEdit|Bash");
  assert.ok(trackerHook);
});

test("checkInstall detects missing Claude Code hooks", async () => {
  const repoRoot = await fakeRepo();
  await installIntoRepo(repoRoot);

  await fs.writeFile(
    path.join(repoRoot, ".claude", "settings.json"),
    JSON.stringify({ hooks: {} }),
    "utf8",
  );

  const result = await checkInstall(repoRoot);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("Claude Code hooks"));
});
