# AI Code Tracker

通过 git hooks 和 AI 工具钩子自动追踪每次 commit 中 AI 生成的代码行数。

## 工作原理

### 整体流程

1. AI 工具（opencode / Claude Code）编辑文件前，hook 捕获文件内容快照
2. 编辑完成后，hook 将文件新内容与快照做 diff，计算出 AI 新增的行
3. 新增行记录到 `.ai-tracking/pending-lines.json`
4. `git commit` 时，pre-commit hook 将 pending lines 与 staged diff 匹配，生成统计
5. post-commit hook 将统计数据写入 CSV，并创建一条 `[ai-tracking]` 追踪提交

### Snapshot（快照）

快照是每次编辑文件**之前**捕获的文件内容副本，用于和编辑后的内容做 diff，计算 AI 新增了哪些行。

存储位置：`.ai-tracking/snapshots/`

有两种快照：

- **即时快照**（`<toolUseId>.json`）：每次编辑都重新捕获，post-hook 完成后删除
- **原始快照**（`original-<filename>.json`）：只在文件第一次被编辑时创建，跨多次编辑保留

原始快照的作用：当 AI 对同一个文件多次编辑时，diff 始终从第一次编辑前的基线开始计算，避免中间编辑产生的残留行被重复统计。在 post-commit 时自动清理。

### 支持的 AI 工具

| 工具 | 追踪方式 |
|------|---------|
| opencode | 插件系统（`tool.execute.before/after` 事件，内存中的 Map） |
| Claude Code | Git hooks（每次工具调用启动独立进程，文件系统快照） |

## 安装

```bash
node install-to-project.js /path/to/your/project
```

安装后会在目标项目中配置 git hooks 和 AI 工具钩子。

## 数据存储

所有追踪数据存储在项目的 `.ai-tracking/` 目录中：

```
.ai-tracking/
├── config.json              # 配置（enabled, ignore, count_blank_lines）
├── pending-lines.json       # 待匹配的 AI 新增行
├── pending-commit.json      # pre-commit 生成的统计（post-commit 消费）
├── tracking-message.txt     # 追踪提交的 commit message
├── snapshots/               # 快照文件
├── authors/                 # 按作者分组的 CSV 统计
└── archive/                 # pre-push 归档的文件
```

## 开发

```bash
# 运行测试
npm test
```
