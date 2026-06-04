# ai-code-tracker 自动升级 — 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 所有安装了 ai-code-tracker 的项目可自动检查 GitHub Releases 更新，用户确认后执行整项目替换升级。

**Architecture:** 新增 `src/tracker/updater.js` 核心模块处理版本检查、下载、备份、升级、回滚；新增 `src/cli/ai-update.js` 命令入口；修改 `src/cli/install.js` 安装时记录版本信息；修改 `src/opencode/ai-code-tracker.js` 启动时触发自动检查。通过 GitHub Releases API 获取最新版本。

**Tech Stack:** Node.js, GitHub Releases API, semver 对比

---

### Task 1: 核心模块 `src/tracker/updater.js`

**Files:**
- Create: `src/tracker/updater.js`
- Test: `test/updater.test.js`

- [ ] **Step 1: 创建 `src/tracker/updater.js`**

```javascript
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { configPath } from "./paths.js";
import { loadConfig } from "./shared.js";
import { atomicWriteJson } from "./lock.js";
import { logInfo, startTimer } from "./logger.js";

const SKILL_DIR = ".opencode/skills/ai-code-tracker";
const BACKUP_DIR = ".ai-tracking/backup-pre-update";
const AVAILABLE_UPDATE_FILE = ".ai-tracking/available-update.json";

const GITHUB_API = "https://api.github.com/repos/yooocen/ai-commit-statistic-skill/releases/latest";

export function parseTag(tag) {
  return (tag || "").replace(/^v/, "");
}

export async function checkVersion(repoRoot) {
  const config = await loadConfig(repoRoot);
  if (!config.check_updates) return null;

  // Respect update check interval
  const intervalHours = config.update_check_interval_hours ?? 24;
  const lastCheck = config.last_update_check;
  if (lastCheck) {
    const hoursSinceLastCheck = (Date.now() - new Date(lastCheck).getTime()) / 3600000;
    if (hoursSinceLastCheck < intervalHours) {
      // Within interval: return cached result if available
      const cached = await readAvailableUpdate(repoRoot);
      if (cached) return cached;
    }
  }

  const localVersion = config.installed_version || "0.0.0";

  let data;
  try {
    const res = await fetch(GITHUB_API);
    if (!res.ok) {
      await logInfo(repoRoot, "updater.checkVersion", `GitHub API returned ${res.status}`);
      return null;
    }
    data = await res.json();
  } catch (error) {
    await logInfo(repoRoot, "updater.checkVersion", `fetch failed: ${error.message}`);
    return null;
  }

  const remoteVersion = parseTag(data.tag_name);
  if (remoteVersion === localVersion) {
    await logInfo(repoRoot, "updater.checkVersion", "already up to date", { version: localVersion });
    await clearAvailableUpdate(repoRoot);
    return null;
  }

  const updateInfo = {
    local_version: localVersion,
    remote_version: remoteVersion,
    tag_name: data.tag_name,
    release_url: data.html_url,
    tarball_url: data.tarball_url,
    body: (data.body || "").slice(0, 500),
    checked_at: new Date().toISOString(),
  };

  await saveAvailableUpdate(repoRoot, updateInfo);
  await logInfo(repoRoot, "updater.checkVersion", "update available", { local: localVersion, remote: remoteVersion });

  // Update last_update_check timestamp
  config.last_update_check = new Date().toISOString();
  await atomicWriteJson(configPath(repoRoot), config);

  return updateInfo;
}

export async function readAvailableUpdate(repoRoot) {
  try {
    const content = await fs.readFile(path.join(repoRoot, AVAILABLE_UPDATE_FILE), "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function saveAvailableUpdate(repoRoot, data) {
  const filePath = path.join(repoRoot, AVAILABLE_UPDATE_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function clearAvailableUpdate(repoRoot) {
  try {
    await fs.rm(path.join(repoRoot, AVAILABLE_UPDATE_FILE), { force: true });
  } catch {}
}

export async function backup(repoRoot) {
  const timer = startTimer();
  const src = path.join(repoRoot, SKILL_DIR);
  const dest = path.join(repoRoot, BACKUP_DIR);

  // Remove previous backup
  await fs.rm(dest, { recursive: true, force: true });

  // Copy current skill directory to backup
  await fs.cp(src, dest, { recursive: true, force: true });
  await logInfo(repoRoot, "updater.backup", "backup created", { durationMs: timer.elapsedMs() });
}

export async function downloadAndUpgrade(repoRoot, updateInfo) {
  const timer = startTimer();

  // 1. Backup
  await logInfo(repoRoot, "updater.upgrade", "starting upgrade", { version: updateInfo.remote_version });
  await backup(repoRoot);

  // 2. Download
  const tmpDir = path.join(repoRoot, ".ai-tracking", ".update-tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const tarballPath = path.join(tmpDir, "release.tar.gz");

  try {
    await logInfo(repoRoot, "updater.upgrade", "downloading release", { url: updateInfo.tarball_url });
    const res = await fetch(updateInfo.tarball_url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    await fs.writeFile(tarballPath, Buffer.from(buffer));

    // 3. Extract
    await logInfo(repoRoot, "updater.upgrade", "extracting release");
    const extractDir = path.join(tmpDir, "extracted");
    await fs.mkdir(extractDir, { recursive: true });
    execFileSync("tar", ["xzf", tarballPath, "--strip-components=1", "-C", extractDir], { cwd: tmpDir });

    // 4. Replace skill files
    const skillDest = path.join(repoRoot, SKILL_DIR);
    const srcLib = path.join(extractDir, "src");
    const srcScripts = path.join(extractDir, "scripts", "ai-update.js");

    // Copy lib (src -> lib)
    const libDest = path.join(skillDest, "lib");
    await fs.cp(srcLib, libDest, { recursive: true, force: true });

    // Copy scripts
    const scriptsSrc = path.join(extractDir, "scripts");
    const scriptsDest = path.join(skillDest, "scripts");
    const scriptsToCopy = ["ai-update.js", "install.js", "commit-stats.js", "claude-code-hook.js", "ai-code-stats.js"];
    for (const script of scriptsToCopy) {
      const srcFile = path.join(scriptsSrc, script);
      try {
        await fs.copyFile(srcFile, path.join(scriptsDest, script));
      } catch (error) {
        await logInfo(repoRoot, "updater.upgrade", `script ${script} not found in release`, { error: error.message });
      }
    }

    // Copy commands
    const commandsSrc = path.join(extractDir, "commands");
    const commandsDest = path.join(skillDest, "commands");
    await fs.cp(commandsSrc, commandsDest, { recursive: true, force: true });

    // Copy SKILL.md
    const skillMdSrc = path.join(extractDir, "SKILL.md");
    try {
      await fs.copyFile(skillMdSrc, path.join(skillDest, "SKILL.md"));
    } catch {}

    // 5. Re-run install
    await logInfo(repoRoot, "updater.upgrade", "running install.js");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    await execFileAsync("node", ["--experimental-vm-modules", path.join(skillDest, "scripts", "install.js")], { cwd: repoRoot });

    // 6. Update config version
    const cfg = JSON.parse(await fs.readFile(configPath(repoRoot), "utf8"));
    cfg.installed_version = updateInfo.remote_version;
    cfg.last_update_check = new Date().toISOString();
    const { atomicWriteJson } = await import("./lock.js");
    await atomicWriteJson(configPath(repoRoot), cfg);

    // 7. Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
    await clearAvailableUpdate(repoRoot);

    await logInfo(repoRoot, "updater.upgrade", "upgrade complete", { version: updateInfo.remote_version, durationMs: timer.elapsedMs() });
    return { ok: true, version: updateInfo.remote_version };
  } catch (error) {
    await logInfo(repoRoot, "updater.upgrade", `upgrade failed: ${error.message}`);
    // Attempt rollback
    try {
      await rollback(repoRoot);
    } catch (rollbackError) {
      await logInfo(repoRoot, "updater.rollback", `rollback failed: ${rollbackError.message}`);
    }
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function rollback(repoRoot) {
  const timer = startTimer();
  const backupSrc = path.join(repoRoot, BACKUP_DIR);
  const dest = path.join(repoRoot, SKILL_DIR);

  const stat = await fs.stat(backupSrc).catch(() => null);
  if (!stat) {
    await logInfo(repoRoot, "updater.rollback", "no backup found");
    throw new Error("No backup available for rollback");
  }

  // Remove broken installation
  await fs.rm(dest, { recursive: true, force: true });
  // Restore from backup
  await fs.cp(backupSrc, dest, { recursive: true, force: true });
  // Remove backup
  await fs.rm(backupSrc, { recursive: true, force: true });

  await logInfo(repoRoot, "updater.rollback", "rollback complete", { durationMs: timer.elapsedMs() });
}
```

- [ ] **Step 2: Write failing tests for updater.js**

```javascript
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { checkVersion, readAvailableUpdate, parseTag, backup, rollback } from "../src/tracker/updater.js";
import { configPath } from "../src/tracker/paths.js";

// Save original fetch so we can restore it
const originalFetch = globalThis.fetch;

function mockGitHubApi(responseJson) {
  globalThis.fetch = async (url) => {
    if (url.includes("api.github.com")) {
      return {
        ok: true,
        json: async () => responseJson,
      };
    }
    return originalFetch(url);
  };
}

function mockGitHubApiError(status) {
  globalThis.fetch = async (url) => {
    if (url.includes("api.github.com")) {
      return { ok: false, status };
    }
    return originalFetch(url);
  };
}

function mockGitHubApiNetworkError() {
  globalThis.fetch = async () => { throw new Error("Network error"); };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

async function fakeRepo() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-updater-"));
  await fs.mkdir(path.join(repoRoot, ".git", "hooks"), { recursive: true });
  await fs.writeFile(configPath(repoRoot), JSON.stringify({
    enabled: true,
    installed_version: "0.1.0",
    source_repo: "https://github.com/yooocen/ai-commit-statistic-skill",
    check_updates: false,
    update_check_interval_hours: 24,
    last_update_check: null,
  }), "utf8");
  return repoRoot;
}

function fakeConfig(repoRoot, overrides = {}) {
  return fs.writeFile(configPath(repoRoot), JSON.stringify({
    enabled: true,
    installed_version: "0.1.0",
    source_repo: "https://github.com/yooocen/ai-commit-statistic-skill",
    check_updates: false,
    update_check_interval_hours: 24,
    last_update_check: null,
    ...overrides,
  }), "utf8");
}

test("parseTag strips v prefix", () => {
  assert.equal(parseTag("v0.2.0"), "0.2.0");
  assert.equal(parseTag("0.2.0"), "0.2.0");
  assert.equal(parseTag(""), "");
  assert.equal(parseTag(null), "");
});

test("checkVersion returns null when check_updates is false", async () => {
  const repoRoot = await fakeRepo();
  const result = await checkVersion(repoRoot);
  assert.equal(result, null);
});

test("checkVersion detects new version via GitHub API", async () => {
  const repoRoot = await fakeRepo();
  await fakeConfig(repoRoot, { check_updates: true });
  mockGitHubApi({ tag_name: "v0.2.0", html_url: "https://github.com/yooocen/ai-commit-statistic-skill/releases/tag/v0.2.0", tarball_url: "https://api.github.com/repos/yooocen/ai-commit-statistic-skill/tarball/v0.2.0", body: "Bug fixes" });
  try {
    const result = await checkVersion(repoRoot);
    assert.ok(result);
    assert.equal(result.local_version, "0.1.0");
    assert.equal(result.remote_version, "0.2.0");
    assert.equal(result.tag_name, "v0.2.0");
  } finally {
    restoreFetch();
  }
});

test("checkVersion returns null when GitHub API fails", async () => {
  const repoRoot = await fakeRepo();
  await fakeConfig(repoRoot, { check_updates: true });
  mockGitHubApiError(403);
  try {
    const result = await checkVersion(repoRoot);
    assert.equal(result, null);
  } finally {
    restoreFetch();
  }
});

test("checkVersion returns null on network error", async () => {
  const repoRoot = await fakeRepo();
  await fakeConfig(repoRoot, { check_updates: true });
  mockGitHubApiNetworkError();
  try {
    const result = await checkVersion(repoRoot);
    assert.equal(result, null);
  } finally {
    restoreFetch();
  }
});

test("checkVersion respects update_check_interval_hours and returns cached", async () => {
  const repoRoot = await fakeRepo();
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  await fakeConfig(repoRoot, { check_updates: true, last_update_check: oneHourAgo, update_check_interval_hours: 24 });

  // Write a cached update
  const cacheDir = path.join(repoRoot, ".ai-tracking");
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(path.join(cacheDir, "available-update.json"), JSON.stringify({
    local_version: "0.1.0",
    remote_version: "0.2.0",
    tag_name: "v0.2.0",
    release_url: "https://example.com",
    tarball_url: "https://example.com/tarball",
    checked_at: oneHourAgo,
  }), "utf8");

  const result = await checkVersion(repoRoot);
  assert.ok(result);
  assert.equal(result.remote_version, "0.2.0");
});

test("backup copies skill directory", async () => {
  const repoRoot = await fakeRepo();
  const skillDir = path.join(repoRoot, ".opencode", "skills", "ai-code-tracker");
  await fs.mkdir(path.join(skillDir, "lib"), { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), "# test", "utf8");
  await fs.writeFile(path.join(skillDir, "lib", "test.js"), "// test", "utf8");

  await backup(repoRoot);

  const backupDir = path.join(repoRoot, ".ai-tracking", "backup-pre-update");
  const stat = await fs.stat(backupDir);
  assert.ok(stat.isDirectory());
  assert.ok(await fs.readFile(path.join(backupDir, "lib", "test.js"), "utf8"));
  assert.ok(await fs.readFile(path.join(backupDir, "SKILL.md"), "utf8"));
});

test("backup replaces previous backup", async () => {
  const repoRoot = await fakeRepo();
  const skillDir = path.join(repoRoot, ".opencode", "skills", "ai-code-tracker");
  await fs.mkdir(path.join(skillDir, "lib"), { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), "# v1", "utf8");
  await backup(repoRoot);

  await fs.writeFile(path.join(skillDir, "SKILL.md"), "# v2", "utf8");
  await backup(repoRoot);

  const backupContent = await fs.readFile(path.join(repoRoot, ".ai-tracking", "backup-pre-update", "SKILL.md"), "utf8");
  assert.equal(backupContent, "# v2");
});

test("rollback restores from backup", async () => {
  const repoRoot = await fakeRepo();
  const skillDir = path.join(repoRoot, ".opencode", "skills", "ai-code-tracker");
  await fs.mkdir(path.join(skillDir, "lib"), { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), "# original", "utf8");
  await fs.writeFile(path.join(skillDir, "lib", "test.js"), "// original", "utf8");

  await backup(repoRoot);

  // Tamper with installation
  await fs.writeFile(path.join(skillDir, "SKILL.md"), "# tampered", "utf8");

  await rollback(repoRoot);

  assert.equal(await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8"), "# original");
  assert.equal(await fs.readFile(path.join(skillDir, "lib", "test.js"), "utf8"), "// original");
});

test("rollback throws when no backup exists", async () => {
  const repoRoot = await fakeRepo();
  await assert.rejects(() => rollback(repoRoot), /No backup/);
});
```

- [ ] **Step 3: Run tests to verify they fail** (since `updater.js` doesn't exist yet)

Run: `node --test test/updater.test.js`

- [ ] **Step 4: Implement `updater.js`** (as shown in Step 1 above)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/updater.test.js`
Expected: All 7 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/tracker/updater.js test/updater.test.js
git commit -m "feat: add updater core module for auto-update"
```

---

### Task 2: 添加路径助手

**Files:**
- Modify: `src/tracker/paths.js`

- [ ] **Step 1: Add `availableUpdatePath` and `backupDir` to paths.js**

Add to `src/tracker/paths.js`:

```javascript
export function availableUpdatePath(repoRoot) {
  return path.join(trackerDir(repoRoot), "available-update.json");
}

export function backupDir(repoRoot) {
  return path.join(trackerDir(repoRoot), "backup-pre-update");
}
```

- [ ] **Step 2: Write and run existing tests**

Run: `node --test test/paths.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/tracker/paths.js
git commit -m "feat: add availableUpdatePath and backupDir path helpers"
```

---

### Task 3: 修改 install.js — 安装时记录版本信息

**Files:**
- Modify: `src/cli/install.js` (lines 476-483)
- Modify: `.gitignore`
- Modify: `src/cli/install.js` (EXPECTED_GITIGNORE_LINES)

- [ ] **Step 1: 修改 `expectedConfigObject` 以接受可选参数**

Replace the function in `src/cli/install.js:476-483`:

```javascript
function expectedConfigObject(version) {
  return {
    enabled: true,
    count_blank_lines: false,
    tracking_commit_suffix: "[ai-tracking]",
    auto_tracking_commit: true,
    installed_version: version || "0.1.0",
    source_repo: "https://github.com/yooocen/ai-commit-statistic-skill",
    check_updates: true,
    update_check_interval_hours: 24,
    last_update_check: null,
  };
}
```

- [ ] **Step 2: 修改 `installIntoRepo` 调用处，传入版本号**

In `installIntoRepo`, update the call at line 179:

```javascript
// Read version from package.json
let installedVersion = "0.1.0";
try {
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, ".opencode", "skills", "ai-code-tracker", "package.json"), "utf8"));
  installedVersion = pkg.version || "0.1.0";
} catch {}
if (!await exists(configPath(repoRoot))) {
  await logInfo(repoRoot, "install", "writing tracker config");
  await atomicWriteJson(configPath(repoRoot), expectedConfigObject(installedVersion));
}
```

- [ ] **Step 3: 添加 `backup-pre-update` 到 `.gitignore` 和 `EXPECTED_GITIGNORE_LINES`**

In `src/cli/install.js:324-335`, add to `EXPECTED_GITIGNORE_LINES`:
```
  ".ai-tracking/available-update.json",
  ".ai-tracking/backup-pre-update/",
```

In repo's `.gitignore`, add:
```
.ai-tracking/available-update.json
.ai-tracking/backup-pre-update/
```

- [ ] **Step 4: Run tests**

Run: `node --test test/install.test.js`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/cli/install.js .gitignore
git commit -m "feat: record version info during install, update gitignore"
```

---

### Task 4: CLI 命令 `src/cli/ai-update.js`

**Files:**
- Create: `src/cli/ai-update.js`

- [ ] **Step 1: Create `src/cli/ai-update.js`**

```javascript
#!/usr/bin/env node
import { gitRepoRoot } from "../tracker/git.js";
import { checkVersion, readAvailableUpdate, downloadAndUpgrade } from "../tracker/updater.js";

export async function runAiCodeUpdate(args = process.argv.slice(2)) {
  const cwd = process.cwd();
  const repoRoot = await gitRepoRoot(cwd);

  const mode = args.includes("--check") ? "check" : "upgrade";

  if (mode === "check") {
    const updateInfo = await checkVersion(repoRoot);
    if (!updateInfo) {
      console.log("[ai-code-tracker] 当前已是最新版本");
      return;
    }
    console.log(`[ai-code-tracker] 发现新版本: ${updateInfo.local_version} → ${updateInfo.remote_version}`);
    console.log(`  发布说明: ${updateInfo.release_url}`);
    if (updateInfo.body) console.log(`  更新说明: ${updateInfo.body}`);
    return;
  }

  // Upgrade mode
  const updateInfo = await readAvailableUpdate(repoRoot) || await checkVersion(repoRoot);
  if (!updateInfo) {
    console.log("[ai-code-tracker] 当前已是最新版本");
    return;
  }

  // Confirm with user
  console.log(`[ai-code-tracker] 发现新版本: ${updateInfo.local_version} → ${updateInfo.remote_version}`);
  if (!args.includes("--yes")) {
    console.log("[ai-code-tracker] 运行 'ai-update --yes' 确认升级");
    return;
  }

  console.log(`[ai-code-tracker] 开始升级: ${updateInfo.local_version} → ${updateInfo.remote_version}`);
  try {
    const result = await downloadAndUpgrade(repoRoot, updateInfo);
    console.log(`[ai-code-tracker] 升级完成: ${result.version}`);
    console.log("[ai-code-tracker] 请重启当前 opencode 会话使升级生效");
  } catch (error) {
    console.error(`[ai-code-tracker] 升级失败: ${error.message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAiCodeUpdate().catch((error) => {
    console.error(`[ai-code-tracker] ${error.message}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 2: Create test file `test/aiUpdate.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";

test("ai-update exports runAiCodeUpdate", async () => {
  const mod = await import("../src/cli/ai-update.js");
  assert.equal(typeof mod.runAiCodeUpdate, "function");
});
```

- [ ] **Step 3: Run tests**

Run: `node --test test/aiUpdate.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/ai-update.js test/aiUpdate.test.js
git commit -m "feat: add ai-update CLI command"
```

---

### Task 5: 脚本包装器和命令定义

**Files:**
- Create: `.opencode/skills/ai-code-tracker/scripts/ai-update.js`
- Create: `.opencode/skills/ai-code-tracker/commands/opencode/ai-update.md` (source — deployed by install.js to `.opencode/commands/ai-update.md`)
- Create: `.claude/skills/ai-code-tracker/commands/claude/ai-update.md` (source — deployed by install.js to `.claude/commands/ai-update.md`)

- [ ] **Step 1: Create script wrapper `scripts/ai-update.js`**

```javascript
#!/usr/bin/env node
import { runAiCodeUpdate } from "../lib/cli/ai-update.js";

runAiCodeUpdate().catch((error) => {
  console.error(`[ai-code-tracker] ${error.message}`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Create opencode command `.opencode/skills/ai-code-tracker/commands/opencode/ai-update.md`**

```markdown
---
description: Check and apply ai-code-tracker updates
---

Check if a new version of ai-code-tracker is available:

!`node .opencode/skills/ai-code-tracker/scripts/ai-update.js --check`

If an update is available, run with --yes to confirm and upgrade:

!`node .opencode/skills/ai-code-tracker/scripts/ai-update.js --yes`

After upgrade, tell the user to restart the current opencode session.
```

- [ ] **Step 3: Create claude command `.claude/skills/ai-code-tracker/commands/claude/ai-update.md`**

Same content as Step 2.

- [ ] **Step 4: Commit**

```bash
git add .opencode/skills/ai-code-tracker/scripts/ai-update.js .opencode/skills/ai-code-tracker/commands/opencode/ai-update.md .claude/skills/ai-code-tracker/commands/claude/ai-update.md
git commit -m "feat: add ai-update script wrapper and command definitions"
```

---

### Task 6: opencode 插件启动时检查更新

**Files:**
- Modify: `src/opencode/ai-code-tracker.js` (line 54-55 area)

- [ ] **Step 1: 添加启动时版本检查**

In `src/opencode/ai-code-tracker.js`, after the plugin initialization log, add async version check:

```javascript
import { checkVersion } from "../tracker/updater.js";

// Inside AiCodeTrackerPlugin, after line 55:
// Start async version check (don't block initialization).
// checkVersion respects update_check_interval_hours so it won't hit
// GitHub API on every startup.
if (repoRootForLog) {
  checkVersion(repoRootForLog).then((update) => {
    if (update) {
      log(client, "warn", `ai-code-tracker 升级可用: ${update.local_version} → ${update.remote_version}，运行 /ai-update 升级`);
    }
  }).catch(() => {});
}
```

- [ ] **Step 3: Run existing tests**

Run: `node --test test/opencodePlugin.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/opencode/ai-code-tracker.js
git commit -m "feat: add startup version check in opencode plugin"
```

---

### Task 7: 更新 `package.json` 和同步脚本

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加 `homepage` 到 `package.json`**

```json
{
  "name": "ai-commit-statistic-skill",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "homepage": "https://github.com/yooocen/ai-commit-statistic-skill",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add homepage field to package.json"
```

---

### Task 8: 全量测试

- [ ] **Step 1: 运行所有测试**

Run: `npm test`
Expected: All existing tests + new tests pass

- [ ] **Step 2: 如有测试失败，修复**

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "test: fix tests after auto-update changes"
```
