---
name: ai-code-tracker-auto-update
description: ai-code-tracker 自动升级设计。已安装该 skill 的项目可自动检查 GitHub Releases 更新，提示用户确认后执行整项目替换升级。
---

# ai-code-tracker 自动升级 — 设计文档

## 问题

`ai-code-tracker` 是一个 opencode skill，通过 `install-to-project.js` 安装到其他项目中，安装位置为 `.opencode/skills/ai-code-tracker/`。当源码仓库（`ai-commit-statistic-skill`）修复 bug 或发布新功能时，已安装该 skill 的项目无法感知更新，导致修复无法传递到已安装项目。

## 目标

- 已安装 `ai-code-tracker` 的项目可自动检查 GitHub Releases 是否有新版本
- 发现新版本时提示用户，用户确认后执行升级
- 整项目替换，升级前备份以便回滚
- 支持 `/ai-update` 命令手动触发，也支持 opencode 启动时自动检查（仅提示）
- 不引入额外基础设施，依赖 GitHub Releases

## 非目标

- 不强制自动升级（用户确认后才执行）
- 不支持增量补丁（整项目替换）
- 不支持推送到没有 GitHub 网络访问的环境（私有网络需自行处理）

## 方案

### 架构

```
┌──────────────────────┐      GitHub API       ┌──────────────────┐
│  ai-code-tracker     │ ◄───────────────────  │  GitHub Releases  │
│  (已安装到项目)       │   GET /releases/latest │  ai-commit-       │
│                      │                       │  statistic-skill  │
│  updater.js:         │                       └──────────────────┘
│    - checkVersion()  │
│    - download()      │
│    - upgrade()       │
│    - rollback()      │
└──────────────────────┘
```

### 1. 版本追踪

`install.js` 执行时从 `package.json` 读取版本并写入 `.ai-tracking/config.json`：

```json
{
  "installed_version": "0.1.0",
  "source_repo": "https://github.com/yooocen/ai-commit-statistic-skill",
  "check_updates": true,
  "update_check_interval_hours": 24,
  "last_update_check": null
}
```

`package.json` 新增 `homepage` 字段指向 GitHub 仓库，供 `updater.js` 读取以构造 GitHub API 请求 URL。

### 2. 更新检查

**GitHub API 调用：**

```
GET https://api.github.com/repos/yooocen/ai-commit-statistic-skill/releases/latest
```

返回示例：
```json
{
  "tag_name": "v0.2.0",
  "name": "v0.2.0",
  "body": "Bug fixes and improvements",
  "html_url": "https://github.com/yooocen/ai-commit-statistic-skill/releases/tag/v0.2.0",
  "tarball_url": "https://api.github.com/repos/yooocen/ai-commit-statistic-skill/tarball/v0.2.0"
}
```

**版本对比：** `semver` 比较 `tag_name`（去掉 `v` 前缀）与 `installed_version`。

**缓存：** 检查结果写入 `.ai-tracking/available-update.json`，避免重复调用 API。

**GitHub API 限流处理：** 未认证的请求限流 60次/小时，使用缓存控制；不考虑认证（简化）。

### 3. 触发时机

#### 方式 A：opencode 启动时自动检查

在 `src/opencode/ai-code-tracker.js` 的 `onStart` 事件中触发：

1. 检查 `check_updates` 是否为 `true`
2. 检查 `last_update_check` 是否超过 `update_check_interval_hours`
3. 调用 `updater.checkVersion()`
4. 如果有新版本，在 opencode 中输出提示信息：
   > "ai-code-tracker 有新版本 v0.2.0（当前 v0.1.0），运行 /ai-update 升级"
5. 更新 `last_update_check`

#### 方式 B：/ai-update 命令

新增斜杠命令，支持两步操作：

- **检查模式**（无参数）：检查更新，显示版本对比
- **升级模式**（确认后）：执行完整升级流程

### 4. 升级流程

```
/ai-update
  ├─ checkVersion() → 无更新 → "当前已是最新版本 v0.1.0"
  └─ checkVersion() → 有更新 v0.2.0
       └─ 提示用户确认升级？
            ├─ 否 → 退出
            └─ 是 →
                 1. backup()    → cp -r .opencode/skills/ai-code-tracker/ → .ai-tracking/backup-pre-update/
                 2. download()  → curl -L tarball_url → /tmp/ai-tracker-update/
                 3. extract()   → tar xzf → /tmp/ai-tracker-update/
                 4. replace()   → cp -r /tmp/ai-tracker-update/lib/ → .opencode/skills/ai-code-tracker/lib/
                                  cp -r /tmp/ai-tracker-update/scripts/ → .opencode/skills/ai-code-tracker/scripts/
                                  cp -r /tmp/ai-tracker-update/commands/ → .opencode/skills/ai-code-tracker/commands/
                                  cp -r /tmp/ai-tracker-update/SKILL.md → .opencode/skills/ai-code-tracker/SKILL.md
                 5. reinstall() → node .opencode/skills/ai-code-tracker/scripts/install.js
                 6. updateVersion() → 写入 installed_version = "0.2.0" 到 config.json
                 7. cleanup()   → rm -rf /tmp/ai-tracker-update/
                 8. 输出 "升级完成，请重启 opencode 会话"
```

### 5. 回滚

升级流程中任一步骤失败时（download 失败、install.js 报错等）：

```
rollback()
  ├─ 存在 .ai-tracking/backup-pre-update/？
  │    ├─ 否 → 输出 "升级失败，且无备份可用，请手动修复"
  │    └─ 是 →
  │         cp -r .ai-tracking/backup-pre-update/* → .opencode/skills/ai-code-tracker/
  │         rm -rf .ai-tracking/backup-pre-update/
  │         输出 "升级失败，已回滚到 v0.1.0"
  └─ 退出
```

### 6. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/tracker/updater.js` | 新增 | 版本检查(`checkVersion`)、下载(`download`)、升级(`upgrade`)、备份(`backup`)、回滚(`rollback`) |
| `src/cli/install.js` | 修改 | install 时写入 `installed_version`、`source_repo` 等配置 |
| `src/cli/ai-update.js` | 新增 | `/ai-update` 命令入口，编排检查/升级流程 |
| `src/opencode/ai-code-tracker.js` | 修改 | `onStart` 中触发自动版本检查 |
| `package.json` | 修改 | 添加 `homepage` 字段 |
| `.opencode/commands/ai-update/` | 新增 | opencode 斜杠命令定义 |
| `.claude/commands/ai-update/` | 新增 | Claude Code 命令定义 |
| `.ai-tracking/config.json` | 运行时 | install 时写入版本配置 |
| `.ai-tracking/available-update.json` | 运行时 | 更新检查结果缓存 |
| `.ai-tracking/backup-pre-update/` | 运行时 | 升级前备份（保留最近一次） |
| `.gitignore` | 修改 | 忽略 `backup-pre-update/` |

### 7. 向下兼容

- 旧版本安装的项目 `config.json` 中无 `installed_version` 字段，`checkVersion()` 将其视为 `"0.0.0"`（总是可升级）
- 不修改现有追踪数据格式
- 不修改现有 hook 逻辑
- `/ai-update` 命令仅在新版本中可用

### 8. 测试

- `updater.test.js`：版本对比、API 响应解析、下载、升级流程
- 模拟 GitHub API 响应（mock fetch）
- 测试回滚逻辑
