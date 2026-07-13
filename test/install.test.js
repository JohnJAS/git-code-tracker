import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { checkInstall, installIntoRepo, moduleDirFromFileUrl } from "../src/cli/install.js";
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

// --- Three-branch logic tests ---

const TOOL_ENV_KEYS = ["CLAUDE_CODE", "CLAUDE_CODE_SESSION", "OPENCODE_SESSION", "CAC_SESSION", "CODEAGENT_CLI", "CODEAGENT_SESSION", "AI_CODE_TRACKER_PROCESS_TREE"];

function saveToolEnv() {
  const saved = {};
  for (const key of TOOL_ENV_KEYS) { saved[key] = process.env[key]; }
  return saved;
}

function restoreToolEnv(saved) {
  for (const key of TOOL_ENV_KEYS) {
    if (saved[key] !== undefined) { process.env[key] = saved[key]; }
    else { delete process.env[key]; }
  }
}

function setToolEnv(tool) {
  for (const key of TOOL_ENV_KEYS) { delete process.env[key]; }
  // Override process tree to prevent host environment from leaking into tests
  process.env.AI_CODE_TRACKER_PROCESS_TREE = "";
  if (tool === "opencode") { process.env.OPENCODE_SESSION = "test"; }
  else if (tool === "claude") { process.env.CLAUDE_CODE = "1"; }
  else if (tool === "codeagent-cli") { process.env.CAC_SESSION = "1"; }
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

const COMMAND_FILES = ["ai-install.md", "ai-repair.md", "ai-check.md", "ai-stats.md", "ai-uninstall.md"];

test("moduleDirFromFileUrl converts Windows drive-letter file URLs to absolute paths", () => {
  const fileUrl = "file:///D:/repo/.opencode/skills/ai-code-tracker/lib/cli/install.js";

  const moduleDir = moduleDirFromFileUrl(fileUrl, path.win32, (url) => fileURLToPath(url, { windows: true }));

  assert.equal(moduleDir, "D:\\repo\\.opencode\\skills\\ai-code-tracker\\lib\\cli");
  assert.equal(path.win32.isAbsolute(moduleDir), true);
  assert.doesNotMatch(moduleDir, /^\/[A-Za-z]:/);
});

test("opencode detected: installs only opencode plugin and commands", async () => {
  const repoRoot = await fakeRepo();
  const saved = saveToolEnv();
  setToolEnv("opencode");

  try {
    await installIntoRepo(repoRoot);

    // opencode plugin + commands exist
    assert.ok(await fileExists(opencodePluginPath(repoRoot)));
    for (const file of COMMAND_FILES) {
      assert.ok(await fileExists(path.join(repoRoot, ".opencode", "commands", file)), `missing ${file}`);
    }

    // Claude hooks NOT installed
    assert.ok(!(await fileExists(path.join(repoRoot, ".claude", "settings.json"))));

    // Claude commands NOT deployed
    assert.ok(!(await fileExists(path.join(repoRoot, ".claude", "commands", "ai-install.md"))));
  } finally {
    restoreToolEnv(saved);
  }
});

test("claude detected: installs only Claude hooks and commands", async () => {
  const repoRoot = await fakeRepo();
  const saved = saveToolEnv();
  setToolEnv("claude");

  try {
    await installIntoRepo(repoRoot);

    // Claude hooks exist
    const settings = JSON.parse(await fs.readFile(path.join(repoRoot, ".claude", "settings.json"), "utf8"));
    assert.ok(settings.hooks.PreToolUse.find((e) => e.matcher === "Edit|Write|NotebookEdit|Bash"));

    // Claude commands exist
    for (const file of COMMAND_FILES) {
      assert.ok(await fileExists(path.join(repoRoot, ".claude", "commands", file)), `missing ${file}`);
    }

    // opencode plugin NOT installed
    assert.ok(!(await fileExists(opencodePluginPath(repoRoot))));

    // opencode commands NOT deployed
    assert.ok(!(await fileExists(path.join(repoRoot, ".opencode", "commands", "ai-install.md"))));
  } finally {
    restoreToolEnv(saved);
  }
});

test("claude detected: writes Claude-specific AGENTS rule", async () => {
  const repoRoot = await fakeRepo();
  const saved = saveToolEnv();
  setToolEnv("claude");

  try {
    await installIntoRepo(repoRoot);

    const agents = await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8");
    assert.match(agents, /Claude Code skill `ai-code-tracker`/);
    assert.match(agents, /current Claude Code session/);
    assert.doesNotMatch(agents, /opencode startup/);
  } finally {
    restoreToolEnv(saved);
  }
});

test("installer replaces old opencode AGENTS rule for detected tool", async () => {
  const repoRoot = await fakeRepo();
  const saved = saveToolEnv();
  setToolEnv("claude");
  await fs.writeFile(
    path.join(repoRoot, "AGENTS.md"),
    [
      "# Project Notes",
      "",
      "Keep this.",
      "",
      "## AI Code Tracker",
      "",
      "Before modifying code in this repository, load the opencode skill `ai-code-tracker` and run its preflight check.",
      "",
      "After installing or repairing ai-code-tracker, tell the user to restart the current opencode session because project plugins are loaded at opencode startup.",
      "",
      "## Other Section",
      "",
      "Keep this too.",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    await installIntoRepo(repoRoot);

    const agents = await fs.readFile(path.join(repoRoot, "AGENTS.md"), "utf8");
    assert.match(agents, /# Project Notes/);
    assert.match(agents, /## Other Section/);
    assert.match(agents, /Claude Code skill `ai-code-tracker`/);
    assert.doesNotMatch(agents, /opencode startup/);
  } finally {
    restoreToolEnv(saved);
  }
});

test("codeagent-cli detected: installs only codeagent-cli hooks and commands", async () => {
  const repoRoot = await fakeRepo();
  const saved = saveToolEnv();
  setToolEnv("codeagent-cli");

  try {
    await installIntoRepo(repoRoot);

    const settings = JSON.parse(await fs.readFile(path.join(repoRoot, ".cac", "settings.json"), "utf8"));
    assert.ok(settings.hooks.PreToolUse.find((e) => e.matcher === "Edit|Write|NotebookEdit|Bash"));
    assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /\.cac\/skills\/ai-code-tracker\/scripts\/claude-code-hook\.js/);

    for (const file of COMMAND_FILES) {
      assert.ok(await fileExists(path.join(repoRoot, ".cac", "commands", file)), `missing ${file}`);
    }

    assert.ok(!(await fileExists(opencodePluginPath(repoRoot))));
    assert.ok(!(await fileExists(path.join(repoRoot, ".opencode", "commands", "ai-install.md"))));
    assert.ok(!(await fileExists(path.join(repoRoot, ".claude", "settings.json"))));
    assert.ok(!(await fileExists(path.join(repoRoot, ".claude", "commands", "ai-install.md"))));
  } finally {
    restoreToolEnv(saved);
  }
});

test("unknown tool: installs opencode, Claude, and codeagent-cli", async () => {
  const repoRoot = await fakeRepo();
  const saved = saveToolEnv();
  setToolEnv("unknown");

  try {
    await installIntoRepo(repoRoot);

    // opencode plugin exists
    assert.ok(await fileExists(opencodePluginPath(repoRoot)));

    // opencode commands exist
    for (const file of COMMAND_FILES) {
      assert.ok(await fileExists(path.join(repoRoot, ".opencode", "commands", file)), `missing ${file}`);
    }

    // Claude hooks exist
    const settings = JSON.parse(await fs.readFile(path.join(repoRoot, ".claude", "settings.json"), "utf8"));
    assert.ok(settings.hooks.PreToolUse.find((e) => e.matcher === "Edit|Write|NotebookEdit|Bash"));

    // Claude commands exist
    for (const file of COMMAND_FILES) {
      assert.ok(await fileExists(path.join(repoRoot, ".claude", "commands", file)), `missing ${file}`);
    }

    // codeagent-cli hooks and commands exist
    const cacSettings = JSON.parse(await fs.readFile(path.join(repoRoot, ".cac", "settings.json"), "utf8"));
    assert.ok(cacSettings.hooks.PreToolUse.find((e) => e.matcher === "Edit|Write|NotebookEdit|Bash"));
    for (const file of COMMAND_FILES) {
      assert.ok(await fileExists(path.join(repoRoot, ".cac", "commands", file)), `missing ${file}`);
    }
  } finally {
    restoreToolEnv(saved);
  }
});

test("checkInstall passes when tool matches install", async () => {
  const repoRoot = await fakeRepo();
  const saved = saveToolEnv();

  // Install with opencode env
  setToolEnv("opencode");
  await installIntoRepo(repoRoot);

  try {
    // Check still with opencode env
    const result = await checkInstall(repoRoot);
    assert.equal(result.ok, true, `missing=${JSON.stringify(result.missing)} mismatches=${JSON.stringify(result.mismatches)}`);
  } finally {
    restoreToolEnv(saved);
  }
});

test("checkInstall fails when tool differs from install", async () => {
  const repoRoot = await fakeRepo();
  const saved = saveToolEnv();

  // Install with opencode env
  setToolEnv("opencode");
  await installIntoRepo(repoRoot);

  // Switch to claude env for check
  setToolEnv("claude");

  try {
    const result = await checkInstall(repoRoot);
    assert.equal(result.ok, false);
    assert.ok(result.missing.includes("Claude Code hooks"));
  } finally {
    restoreToolEnv(saved);
  }
});
