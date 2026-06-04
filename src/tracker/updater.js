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

  const intervalHours = config.update_check_interval_hours ?? 24;
  const lastCheck = config.last_update_check;
  if (lastCheck) {
    const hoursSinceLastCheck = (Date.now() - new Date(lastCheck).getTime()) / 3600000;
    if (hoursSinceLastCheck < intervalHours) {
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

  await fs.rm(dest, { recursive: true, force: true });

  await fs.cp(src, dest, { recursive: true, force: true });
  await logInfo(repoRoot, "updater.backup", "backup created", { durationMs: timer.elapsedMs() });
}

export async function downloadAndUpgrade(repoRoot, updateInfo) {
  const timer = startTimer();

  await logInfo(repoRoot, "updater.upgrade", "starting upgrade", { version: updateInfo.remote_version });
  await backup(repoRoot);

  const tmpDir = path.join(repoRoot, ".ai-tracking", ".update-tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const tarballPath = path.join(tmpDir, "release.tar.gz");

  try {
    await logInfo(repoRoot, "updater.upgrade", "downloading release", { url: updateInfo.tarball_url });
    const res = await fetch(updateInfo.tarball_url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    await fs.writeFile(tarballPath, Buffer.from(buffer));

    await logInfo(repoRoot, "updater.upgrade", "extracting release");
    const extractDir = path.join(tmpDir, "extracted");
    await fs.mkdir(extractDir, { recursive: true });
    execFileSync("tar", ["xzf", tarballPath, "--strip-components=1", "-C", extractDir], { cwd: tmpDir });

    const skillDest = path.join(repoRoot, SKILL_DIR);
    const srcLib = path.join(extractDir, "src");

    const libDest = path.join(skillDest, "lib");
    await fs.cp(srcLib, libDest, { recursive: true, force: true });

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

    const commandsSrc = path.join(extractDir, "commands");
    const commandsDest = path.join(skillDest, "commands");
    await fs.cp(commandsSrc, commandsDest, { recursive: true, force: true });

    const skillMdSrc = path.join(extractDir, "SKILL.md");
    try {
      await fs.copyFile(skillMdSrc, path.join(skillDest, "SKILL.md"));
    } catch {}

    await logInfo(repoRoot, "updater.upgrade", "running install.js");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    await execFileAsync("node", ["--experimental-vm-modules", path.join(skillDest, "scripts", "install.js")], { cwd: repoRoot });

    const cfg = JSON.parse(await fs.readFile(configPath(repoRoot), "utf8"));
    cfg.installed_version = updateInfo.remote_version;
    cfg.last_update_check = new Date().toISOString();
    const { atomicWriteJson } = await import("./lock.js");
    await atomicWriteJson(configPath(repoRoot), cfg);

    await fs.rm(tmpDir, { recursive: true, force: true });
    await clearAvailableUpdate(repoRoot);

    await logInfo(repoRoot, "updater.upgrade", "upgrade complete", { version: updateInfo.remote_version, durationMs: timer.elapsedMs() });
    return { ok: true, version: updateInfo.remote_version };
  } catch (error) {
    await logInfo(repoRoot, "updater.upgrade", `upgrade failed: ${error.message}`);
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

  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(backupSrc, dest, { recursive: true, force: true });
  await fs.rm(backupSrc, { recursive: true, force: true });

  await logInfo(repoRoot, "updater.rollback", "rollback complete", { durationMs: timer.elapsedMs() });
}
