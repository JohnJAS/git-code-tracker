import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { checkVersion, readAvailableUpdate, parseTag, backup, rollback } from "../src/tracker/updater.js";
import { configPath } from "../src/tracker/paths.js";

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
  await fs.mkdir(path.join(repoRoot, ".ai-tracking"), { recursive: true });
  await fs.writeFile(configPath(repoRoot), JSON.stringify({
    enabled: true,
    installedVersion: "0.1.0",
    sourceRepo: "https://github.com/yooocen/git-code-tracker",
    checkUpdates: false,
    updateCheckIntervalHours: 24,
    lastUpdateCheck: null,
  }), "utf8");
  return repoRoot;
}

function fakeConfig(repoRoot, overrides = {}) {
  return fs.mkdir(path.join(repoRoot, ".ai-tracking"), { recursive: true }).then(() =>
    fs.writeFile(configPath(repoRoot), JSON.stringify({
      enabled: true,
      installedVersion: "0.1.0",
      sourceRepo: "https://github.com/yooocen/git-code-tracker",
      checkUpdates: false,
      updateCheckIntervalHours: 24,
      lastUpdateCheck: null,
      ...overrides,
    }), "utf8")
  );
}

test("parseTag strips v prefix", () => {
  assert.equal(parseTag("v0.2.0"), "0.2.0");
  assert.equal(parseTag("0.2.0"), "0.2.0");
  assert.equal(parseTag(""), "");
  assert.equal(parseTag(null), "");
});

test("checkVersion returns null when checkUpdates is false", async () => {
  const repoRoot = await fakeRepo();
  const result = await checkVersion(repoRoot);
  assert.equal(result, null);
});

test("checkVersion detects new version via GitHub API", async () => {
  const repoRoot = await fakeRepo();
  await fakeConfig(repoRoot, { checkUpdates: true });
  mockGitHubApi({ tag_name: "v0.2.0", html_url: "https://github.com/yooocen/git-code-tracker/releases/tag/v0.2.0", tarball_url: "https://api.github.com/repos/yooocen/git-code-tracker/tarball/v0.2.0", body: "Bug fixes" });
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
  await fakeConfig(repoRoot, { checkUpdates: true });
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
  await fakeConfig(repoRoot, { checkUpdates: true });
  mockGitHubApiNetworkError();
  try {
    const result = await checkVersion(repoRoot);
    assert.equal(result, null);
  } finally {
    restoreFetch();
  }
});

test("checkVersion respects updateCheckIntervalHours and returns cached", async () => {
  const repoRoot = await fakeRepo();
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  await fakeConfig(repoRoot, { checkUpdates: true, lastUpdateCheck: oneHourAgo, updateCheckIntervalHours: 24 });

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

  await fs.writeFile(path.join(skillDir, "SKILL.md"), "# tampered", "utf8");

  await rollback(repoRoot);

  assert.equal(await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8"), "# original");
  assert.equal(await fs.readFile(path.join(skillDir, "lib", "test.js"), "utf8"), "// original");
});

test("rollback throws when no backup exists", async () => {
  const repoRoot = await fakeRepo();
  await assert.rejects(() => rollback(repoRoot), /No backup/);
});
