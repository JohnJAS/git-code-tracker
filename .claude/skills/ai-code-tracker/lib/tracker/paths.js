import path from "node:path";

export function trackerDir(repoRoot) {
  return path.join(repoRoot, ".ai-tracking");
}

export function opencodePluginPath(repoRoot) {
  return path.join(repoRoot, ".opencode", "plugins", "ai-code-tracker.js");
}

export function pendingLinesPath(repoRoot) {
  return path.join(trackerDir(repoRoot), "pending-lines.json");
}

export function pendingCommitPath(repoRoot) {
  return path.join(trackerDir(repoRoot), "pending-commit.json");
}

export function trackingMessagePath(repoRoot) {
  return path.join(trackerDir(repoRoot), "tracking-message.txt");
}

export function archiveDir(repoRoot) {
  return path.join(trackerDir(repoRoot), "archive");
}

export function configPath(repoRoot) {
  return path.join(trackerDir(repoRoot), "config.json");
}

export function availableUpdatePath(repoRoot) {
  return path.join(trackerDir(repoRoot), "available-update.json");
}

export function backupDir(repoRoot) {
  return path.join(trackerDir(repoRoot), "backup-pre-update");
}

export function lockPath(repoRoot, name) {
  return path.join(trackerDir(repoRoot), `${name}.lock`);
}

export function snapshotDir(repoRoot) {
  return path.join(trackerDir(repoRoot), "snapshots");
}

export function authorCsvPath(repoRoot, author) {
  return path.join(trackerDir(repoRoot), `${safeFileName(author)}.csv`);
}

export function safeFileName(value) {
  return String(value || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}
