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
    if (updateInfo.body) { console.log(`  更新说明: ${updateInfo.body}`); }
    return;
  }

  const updateInfo = await readAvailableUpdate(repoRoot) || await checkVersion(repoRoot);
  if (!updateInfo) {
    console.log("[ai-code-tracker] 当前已是最新版本");
    return;
  }

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
