# opencode AI 代码追踪工具实现计划

> **给 agentic workers：** 必须使用 `superpowers:subagent-driven-development`（如果可用）或 `superpowers:executing-plans` 执行本计划。步骤使用 checkbox（`- [ ]`）语法便于追踪。

**目标：** 构建一个名为 `ai-code-tracker` 的 opencode 项目级 skill，面向当前仓库记录 AI 新增行，按代码 commit 生成 CSV 统计，并在每次用户代码 commit 后自动创建独立的 `[ai-tracking]` 统计 commit。

**架构：** `.opencode/skills/ai-code-tracker/` 提供 `SKILL.md` 作为 opencode agent 的 preflight、安装、修复和统计入口，`scripts/` 存放安装器、hook CLI、统计 CLI 和 opencode 项目插件，`references/` 存放详细设计。`AGENTS.md` 写入简短项目规则，要求 opencode 在修改代码前先加载 `ai-code-tracker` skill 做安装状态检查；如果未安装，必须询问用户是否安装，用户确认后自动运行项目级安装并复查。安装器只修改当前仓库：把 opencode 插件放到 `.opencode/plugins/`，把 hook/统计脚本放到 `.ai-tracking/bin/`，并注入当前仓库的 git hooks；不会写入全局 opencode 或全局 PATH。

**技术栈：** Node.js ESM、内置 `node:test`、POSIX shell wrapper、git hooks、opencode JavaScript 插件。

---

## 文件结构

- 新建 `package.json`：npm scripts、ESM 配置、测试命令。
- 新建或修改 `AGENTS.md`：要求 opencode 修改代码前先加载 `ai-code-tracker` skill 做 preflight。
- 新建 `.opencode/skills/ai-code-tracker/SKILL.md`：opencode skill frontmatter、preflight、安装、修复和统计流程。
- 新建 `.opencode/skills/ai-code-tracker/references/design.md`：从当前 spec 提炼出的详细设计参考。
- 新建 `src/tracker/paths.js`：集中管理 tracker 相关路径。
- 新建 `src/tracker/lock.js`：本地文件锁与原子写入 helper。
- 新建 `src/tracker/lineStore.js`：读写 pending AI line multiset，并使用锁保护并发写入。
- 新建 `src/tracker/diff.js`：解析 staged git diff，按文件提取新增行。
- 新建 `src/tracker/stats.js`：将 staged 新增行与 pending AI 行匹配，生成 pending commit 数据。
- 新建 `src/tracker/csv.js`：CSV 转义、追加、读取 tracking records。
- 新建 `src/tracker/git.js`：git 命令的薄封装。
- 新建 `src/cli/commit-stats.js`：实现 `pre-commit` 和 `post-commit` 模式。
- 新建 `src/cli/ai-code-stats.js`：读取 `.ai-tracking/*.csv` 并打印统计。
- 新建 `src/cli/install.js`：向当前仓库安装项目级 opencode 插件和 git hooks。
- 新建 `src/cli/verify-opencode-plugin.js`：用于手动验证 opencode 插件事件 API 的最小探针。
- 新建 `src/opencode/ai-code-tracker.js`：opencode 插件入口。
- 新建 `test/*.test.js`：覆盖路径、line store、diff 解析、匹配、CSV、hook 行为。

## 任务 0：opencode 项目 Skill 骨架

**文件：**

- 新建或修改：`AGENTS.md`
- 新建：`.opencode/skills/ai-code-tracker/SKILL.md`
- 新建：`.opencode/skills/ai-code-tracker/references/design.md`

- [ ] **步骤 1：编写 `SKILL.md`**

`SKILL.md` 必须包含 YAML frontmatter：

```yaml
---
name: ai-code-tracker
description: Use when the user wants to install, enable, repair, or inspect opencode AI code contribution tracking in a git repository, including commands like ai-code-stats or requests to track AI-authored lines.
---
```

正文保持简短，只说明：

- preflight 时检查 `.opencode/plugins/ai-code-tracker.js`、`.ai-tracking/config.json`、`.git/hooks/pre-commit`、`.git/hooks/post-commit`
- 如果 preflight 发现未安装或损坏，先询问用户是否安装/修复，不继续改代码
- 用户确认后自动运行 `scripts/install.js` 或 `scripts/install.js --repair`
- 安装/修复后重新执行 preflight；通过后才继续原始代码任务
- 安装时运行 `scripts/install.js`
- 查看统计时运行 `scripts/ai-code-stats.js`
- 修复时运行 `scripts/install.js --repair`
- opencode 事件不确定时先运行 `scripts/verify-opencode-plugin.js`
- 详细设计阅读 `references/design.md`
- 该包只做项目级安装，不写入全局 opencode 配置或全局命令目录。

- [ ] **步骤 2：编写项目规则 `AGENTS.md`**

在 `AGENTS.md` 添加一个简短规则块：

```markdown
## AI Code Tracker

Before modifying code in this repository, load the opencode skill `ai-code-tracker` and run its preflight check. If tracking is not installed or is broken, ask the user whether to install or repair it. If the user confirms, run the project-level install or repair script automatically, rerun preflight, and continue with code changes only after preflight passes.
```

如果已有 `AGENTS.md`，只追加受标记包围的块，不覆盖已有内容。

- [ ] **步骤 3：编写 `references/design.md`**

把 `2026-04-30-ai-code-tracker-design.md` 中的稳定设计复制/整理为 skill 内参考文档。避免复制实现计划，只保留 agent 使用 skill 时需要知道的行为、限制和故障处理。

- [ ] **步骤 4：检查 skill 结构**

确认目录结构至少为：

```text
.opencode/skills/ai-code-tracker/
├── SKILL.md
├── references/design.md
└── scripts/
```

- [ ] **步骤 5：提交**

```bash
git add AGENTS.md .opencode/skills/ai-code-tracker/SKILL.md .opencode/skills/ai-code-tracker/references/design.md
git commit -m "feat: scaffold ai code tracker skill"
```

## 任务 1：opencode 插件 API 探针

**文件：**

- 新建：`src/cli/verify-opencode-plugin.js`
- 新建：`src/opencode/probe-plugin.js`
- 新建：`.opencode/skills/ai-code-tracker/scripts/verify-opencode-plugin.js`
- 新建：`.opencode/skills/ai-code-tracker/scripts/opencode-probe-plugin.js`
- 修改：`2026-04-30-ai-code-tracker-design.md`

- [ ] **步骤 1：创建最小 opencode probe 插件**

插件只记录可用事件 payload，不写 tracker 数据。重点验证 `file.edited` 是否包含编辑前/后的内容、文件路径和工作目录。

- [ ] **步骤 2：运行 opencode 并触发一次文件编辑**

运行：`opencode`，加载 probe 插件，要求 agent 编辑一个临时文本文件。

预期：能捕获可用于计算新增行的事件 payload。

- [ ] **步骤 3：验证 fallback 事件**

如果 `file.edited` 不足以计算新增行，验证 `tool.execute.after` 是否能提供工具名、目标路径和写入后的内容。必要时记录“编辑前快照 + 编辑后读取文件”的 fallback 方案。

- [ ] **步骤 4：更新设计文档**

把设计文档“待确认”中的 opencode 事件说明改成已验证结论，并写明 fallback 路径。

- [ ] **步骤 5：提交**

```bash
git add src/cli/verify-opencode-plugin.js src/opencode/probe-plugin.js .opencode/skills/ai-code-tracker/scripts/verify-opencode-plugin.js .opencode/skills/ai-code-tracker/scripts/opencode-probe-plugin.js 2026-04-30-ai-code-tracker-design.md
git commit -m "test: verify opencode plugin events"
```

## 任务 2：项目脚手架与测试框架

**文件：**

- 新建：`package.json`
- 新建：`src/tracker/paths.js`
- 新建：`test/paths.test.js`

- [ ] **步骤 1：编写路径 helper 的失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { trackerDir, pendingLinesPath, pendingCommitPath } from "../src/tracker/paths.js";

test("builds tracker paths inside repo root", () => {
  assert.equal(trackerDir("/repo"), "/repo/.ai-tracking");
  assert.equal(pendingLinesPath("/repo"), "/repo/.ai-tracking/pending-lines.json");
  assert.equal(pendingCommitPath("/repo"), "/repo/.ai-tracking/pending-commit.json");
});
```

- [ ] **步骤 2：添加带测试命令的 `package.json`**

```json
{
  "name": "ai-commit-statistic-skill",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **步骤 3：运行测试并确认失败**

运行：`npm test`

预期：失败，因为 `src/tracker/paths.js` 尚不存在。

- [ ] **步骤 4：实现路径 helper**

创建 `src/tracker/paths.js`，导出 `trackerDir`、`pendingLinesPath`、`pendingCommitPath`、`trackingMessagePath`、`configPath`、`lockPath` 和 `authorCsvPath`。

- [ ] **步骤 5：运行测试并提交**

运行：`npm test`

预期：通过。

提交：

```bash
git add package.json src/tracker/paths.js test/paths.test.js
git commit -m "test: add tracker path helpers"
```

## 任务 3：核心追踪数据模型

**文件：**

- 新建：`src/tracker/lineStore.js`
- 新建：`src/tracker/lock.js`
- 新建：`src/tracker/diff.js`
- 新建：`src/tracker/stats.js`
- 新建：`test/lineStore.test.js`
- 新建：`test/lock.test.js`
- 新建：`test/diff.test.js`
- 新建：`test/stats.test.js`

- [ ] **步骤 1：测试 pending lines 的 multiset 行为**

覆盖按文件追加行、保留重复行、默认忽略空行，以及只消费已匹配数量的行为。

- [ ] **步骤 2：测试锁与原子写入**

验证锁文件已存在时会等待或失败，写入时先写临时文件再 rename，写入失败不会破坏原文件。

- [ ] **步骤 3：实现 `lock.js`**

提供 `withFileLock(lockPath, fn)` 和 `atomicWriteJson(targetPath, data)`。锁必须有超时，避免进程崩溃后永久卡住。

- [ ] **步骤 4：实现 `lineStore.js`**

提供 `loadPendingLines(repoRoot)`、`savePendingLines(repoRoot, data)`、`appendPendingLines(repoRoot, filePath, lines, options)` 和 `consumeMatchedLines(pending, matched)`。

- [ ] **步骤 5：测试 staged diff 解析**

使用包含普通新增、删除、`+++ b/file` header、重命名文件、二进制文件标记的 diff fixture。预期结果是 `{ "src/a.js": ["line one", "line two"] }`，并排除 diff header。

- [ ] **步骤 6：实现 `diff.js`**

提供 `parseAddedLinesFromDiff(diffText)`，并保持它不依赖真实 git 命令。

- [ ] **步骤 7：测试 AI 行匹配**

给定 pending lines 和 staged added lines，验证 `ai_lines`、`total_lines`、`matched_lines` 都按重复行敏感的 multiset 规则计算。

- [ ] **步骤 8：实现 `stats.js`**

提供 `buildPendingCommit({ pendingLines, addedLines })`。当 `total_lines` 为 `0` 时返回 `null`。

- [ ] **步骤 9：运行测试并提交**

运行：`npm test`

预期：通过。

提交：

```bash
git add src/tracker/lock.js src/tracker/lineStore.js src/tracker/diff.js src/tracker/stats.js test/lock.test.js test/lineStore.test.js test/diff.test.js test/stats.test.js
git commit -m "feat: add AI line matching model"
```

## 任务 4：CSV 与 git hook CLI

**文件：**

- 新建：`src/tracker/csv.js`
- 新建：`src/tracker/git.js`
- 新建：`src/cli/commit-stats.js`
- 新建：`.opencode/skills/ai-code-tracker/scripts/commit-stats.js`
- 新建：`test/csv.test.js`
- 新建：`test/commitStats.test.js`

- [ ] **步骤 1：测试 CSV 转义与读取**

覆盖 commit message 中的逗号、引号、换行，以及读取多个 author CSV 文件。

- [ ] **步骤 2：实现 `csv.js`**

提供 `escapeCsv(value)`、`appendRecord(csvPath, record)` 和 `readRecords(repoRoot)`。

- [ ] **步骤 3：用 stubbed git 测试 pre-commit 模式**

使用依赖注入，避免测试时调用真实 git。验证它会写入 `.ai-tracking/pending-commit.json`，并且不会 stage CSV。

- [ ] **步骤 4：实现 pre-commit 模式**

行为：`AI_CODE_TRACKER_SKIP=1` 时跳过；diff 没有非 tracking 新增时跳过；解析 `git diff --cached --unified=0`；写入 pending commit JSON。

- [ ] **步骤 5：测试递归防护**

验证 `AI_CODE_TRACKER_SKIP=1`、`AI_CODE_TRACKER_DEPTH=1`、最近 commit message 已含 `[ai-tracking]` 时都会跳过 post-commit。

- [ ] **步骤 6：测试暂存区路径校验**

验证 post-commit 自动创建统计提交前，如果暂存区包含非 `.ai-tracking/` 文件，会中止并保留 pending 文件。

- [ ] **步骤 7：用 stubbed git 测试 post-commit 模式**

验证它会读取 pending 数据，获取 SHA、author、date、完整 message，写入 CSV，生成 `tracking-message.txt`，用 `AI_CODE_TRACKER_SKIP=1` 创建 tracking commit，并清理临时文件。

- [ ] **步骤 8：实现 post-commit 模式**

使用 `git commit -F .ai-tracking/tracking-message.txt`。第一行追加 `[ai-tracking]`，原 body 保留；执行 commit 时设置 `AI_CODE_TRACKER_SKIP=1 AI_CODE_TRACKER_DEPTH=1`。

- [ ] **步骤 9：运行测试并提交**

运行：`npm test`

预期：通过。

提交：

```bash
git add src/tracker/csv.js src/tracker/git.js src/cli/commit-stats.js .opencode/skills/ai-code-tracker/scripts/commit-stats.js test/csv.test.js test/commitStats.test.js
git commit -m "feat: add git hook statistics CLI"
```

## 任务 5：项目级安装器与 hook 注入

**文件：**

- 新建：`src/cli/install.js`
- 新建：`.opencode/skills/ai-code-tracker/scripts/install.js`
- 新建：`test/install.test.js`

- [ ] **步骤 1：测试 hook block 的幂等注入**

给定空 hook 和已有 hook，验证安装器只添加一个标记块，并保留已有内容。

- [ ] **步骤 2：实现 hook 注入 helper**

使用标记：

```sh
# ai-code-tracker begin
node ".ai-tracking/bin/commit-stats.js" pre-commit
# ai-code-tracker end
```

- [ ] **步骤 3：测试 `.gitignore` 更新**

验证 pending 文件、`tracking-message.txt` 和 lock files 会被 ignore，且重复安装不会写入重复行。

- [ ] **步骤 4：测试权限和安全检查**

验证不在 git 仓库内、`.opencode/` 不可写、`.git/hooks/` 不可写、`.ai-tracking/` 不可写时，安装器会中止并输出明确错误。

- [ ] **步骤 5：实现仓库安装**

创建 `.opencode/plugins/ai-code-tracker.js`、`.ai-tracking/config.json`、`.ai-tracking/bin/`、hook blocks 和 gitignore 条目。不在 git 仓库内运行时给出清晰错误。

- [ ] **步骤 6：实现 repair 模式**

`node .opencode/skills/ai-code-tracker/scripts/install.js --repair` 应检查 pending 文件、CSV header、hook block、gitignore 条目，并尽量修复缺失项。无法安全修复的数据损坏只报告，不自动猜测。

- [ ] **步骤 7：确保不写入全局位置**

测试安装器不会写入 `~/.config/opencode/`、`~/.local/bin/`、`/usr/local/bin/` 等全局位置。

- [ ] **步骤 8：运行测试并提交**

运行：`npm test`

预期：通过。

提交：

```bash
git add src/cli/install.js .opencode/skills/ai-code-tracker/scripts/install.js test/install.test.js
git commit -m "feat: add tracker installer"
```

## 任务 6：opencode 插件

**文件：**

- 新建：`src/opencode/ai-code-tracker.js`
- 新建：`.opencode/skills/ai-code-tracker/scripts/opencode-plugin.js`
- 新建：`test/opencodePlugin.test.js`
- 修改：`2026-04-30-ai-code-tracker-design.md`

- [ ] **步骤 1：复用任务 0 的 opencode 事件结论**

不要在此任务重新猜测事件 API；只使用任务 0 已验证的事件或 fallback。

- [ ] **步骤 2：用确认后的事件名更新设计文档**

把设计文档当前“待确认”的 opencode 事件说明替换为已验证的集成点。

- [ ] **步骤 3：通过注入事件 payload 测试插件记录编辑**

模拟已确认的事件 payload，验证只有新增的非空文本行会追加到 pending lines。

- [ ] **步骤 4：实现插件**

插件行为：查找 git root，检查 `.ai-tracking/config.json`，忽略配置路径，计算新增行，调用 line store 追加逻辑。

- [ ] **步骤 5：运行测试并提交**

运行：`npm test`

预期：通过。

提交：

```bash
git add src/opencode/ai-code-tracker.js .opencode/skills/ai-code-tracker/scripts/opencode-plugin.js test/opencodePlugin.test.js 2026-04-30-ai-code-tracker-design.md
git commit -m "feat: add opencode edit tracking plugin"
```

## 任务 7：`ai-code-stats` CLI 与端到端验证

**文件：**

- 新建：`src/cli/ai-code-stats.js`
- 新建：`.opencode/skills/ai-code-tracker/scripts/ai-code-stats.js`
- 新建：`test/aiCodeStats.test.js`
- 修改：`2026-04-30-ai-code-tracker-design.md`

- [ ] **步骤 1：测试汇总计算**

给定 CSV records，验证总新增行、AI 新增行、AI 占比、AI 参与 commit 数、已追踪 commit 数、author 过滤、日期过滤和最近记录数量限制。

- [ ] **步骤 2：实现 `ai-code-stats.js`**

默认打印汇总和最近 10 条记录。支持 `--author`、`--since` 和 `--last`。

- [ ] **步骤 3：支持项目内运行**

安装后可通过 `node .ai-tracking/bin/ai-code-stats.js` 在当前仓库查看统计；skill 内可通过 `node .opencode/skills/ai-code-tracker/scripts/ai-code-stats.js` 查看统计。

- [ ] **步骤 4：运行单元测试**

运行：`npm test`

预期：通过。

- [ ] **步骤 5：在临时 git 仓库中运行本地端到端测试**

创建临时仓库，安装 hooks，预置 `.ai-tracking/pending-lines.json`，提交一次代码变更，验证会创建第二个 `[ai-tracking]` commit 并写入 CSV。

预期：

```text
git log --oneline -2
<sha> Implement sample change [ai-tracking]
<sha> Implement sample change
```

- [ ] **步骤 6：测试失败恢复路径**

模拟 post-commit 创建统计提交失败，验证 pending 文件保留、错误信息可操作、`--repair` 能检查 hook 和临时状态。

- [ ] **步骤 7：测试 CI skip 配置**

启用 `tracking_commit_ci_skip` 后，验证统计提交 message 第一行包含 CI skip 标记；默认关闭时不包含。

- [ ] **步骤 8：提交**

```bash
git add src/cli/ai-code-stats.js .opencode/skills/ai-code-tracker/scripts/ai-code-stats.js test/aiCodeStats.test.js 2026-04-30-ai-code-tracker-design.md
git commit -m "feat: add AI code stats CLI"
```

## 最终验证

- [ ] 运行 `npm test` 并确认全部测试通过。
- [ ] 在临时 git 仓库中运行安装器，并确认 hooks 注入具备幂等性。
- [ ] 运行一次 commit flow，并确认不会递归创建 tracking commit。
- [ ] 模拟 post-commit 失败并确认 pending 文件保留，repair 命令能报告状态。
- [ ] 模拟并发写入 pending lines，并确认最终 JSON 未损坏且记录未丢失。
- [ ] 在临时仓库中运行 `node .ai-tracking/bin/ai-code-stats.js --last 10`，确认汇总输出正确。
- [ ] 检查 `2026-04-30-ai-code-tracker-design.md`，移除已经解决的“待确认”条目。
