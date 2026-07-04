---
name: ai-code-tracker-bundle-js
description: ai-code-tracker 打包重构设计。将 src/ 下 16 个实现文件用 esbuild 打成单个 bundle.js，替代散落在 .opencode 与 .claude skill 目录下的 lib/ 副本，减少部署文件数量。
---

# ai-code-tracker 打包为 bundle.js — 设计文档

## 问题

`ai-code-tracker` 的实现源码在 `src/` 下共 16 个文件（`tracker/` ×10、`cli/` ×4、`claude-code/` ×1、`opencode/` ×1）。部署时这 16 个文件被原样复制到两个 skill 目录：

- `.opencode/skills/ai-code-tracker/lib/`
- `.claude/skills/ai-code-tracker/lib/`

加上 6 个薄 wrapper 入口文件（`scripts/` 目录），每个 skill 目录有 16 + 6 = 22 个 JS 文件，两个目录共 44 个散落的部署文件。这带来：

- 文件散射严重，install-to-project 复制、升级替换、git 历史都受拖累
- `src/` 与 `lib/` 两份内容需手动同步，易遗漏
- 升级流程 `updater.js` 用 `fs.cp(src, lib)` 整树复制，文件多、IO 重

## 目标

- 用 esbuild 把 `src/` 的 16 个实现文件打包成**单个** `bundle.js`
- 消除 `lib/` 目录（两个 skill 目录都删）
- 6 个 wrapper 保留，只改 import 路径指向 `./bundle.js`
- `src/` 作为开发源保留（测试直接导入 src）
- `bundle.js` 作为已提交的构建产物，沿用当前 `lib/` 是已提交副本的模式
- 每个 skill 目录 JS 文件数从 22 降到 7（1 bundle + 6 wrapper）

## 非目标

- 不内联 wrapper（保留 wrapper 作为薄入口，避免改动 git hook 命令串与 opencode 插件路径）
- 不做 per-entry 多 bundle（避免共享 tracker 代码 6 倍重复）
- 不改变追踪数据格式、hook 逻辑、CSV 记录逻辑
- 不改变测试对 `src/` 的直接导入

## 方案

### 架构

```
开发态                          构建产物(已提交)
┌──────────────┐  esbuild      ┌─────────────────────────────┐
│ src/         │ ───────────▶  │ .opencode/.../scripts/      │
│  index.js    │   bundle      │   bundle.js   ← 6 wrapper 导入│
│  (barrel)    │               │   *.js (6 wrapper, 改 import)│
│  cli/        │               └─────────────────────────────┘
│  tracker/    │  esbuild      ┌─────────────────────────────┐
│  opencode/   │ ───────────▶  │ .claude/.../scripts/        │
│  claude-code/│   bundle      │   bundle.js                 │
└──────────────┘               │   *.js (6 wrapper)          │
                               └─────────────────────────────┘
```

`scripts/build.js`（仓库根 dev 工具）读取 `src/index.js`，用 esbuild 打成 ESM 格式 `bundle.js`，同时写入两个 skill 目录的 `scripts/` 下。

### 1. Barrel 入口 `src/index.js`（新增）

聚合 6 个 wrapper 实际用到的全部符号（符号已对照 wrapper 与源码导出核实）：

```js
export { runCommitStats } from "./cli/commit-stats.js";
export { runAiCodeStats } from "./cli/ai-code-stats.js";
export { runAiCodeUpdate } from "./cli/ai-update.js";
export { runInstall } from "./cli/install.js";
export { runClaudeCodeHook } from "./claude-code/claude-code-hook.js";
export { AiCodeTrackerPlugin, recordEditedFile } from "./opencode/ai-code-tracker.js";
```

符号与 wrapper 对应关系：

| wrapper | 导入符号 | 源文件 |
|---|---|---|
| `commit-stats.js` | `runCommitStats` | `cli/commit-stats.js` |
| `ai-code-stats.js` | `runAiCodeStats` | `cli/ai-code-stats.js` |
| `ai-update.js` | `runAiCodeUpdate` | `cli/ai-update.js` |
| `install.js` | `runInstall` | `cli/install.js` |
| `claude-code-hook.js` | `runClaudeCodeHook` | `claude-code/claude-code-hook.js` |
| `opencode-plugin.js` | `AiCodeTrackerPlugin`, `recordEditedFile` | `opencode/ai-code-tracker.js` |

### 2. 构建脚本 `scripts/build.js`（新增，仓库根）

```js
#!/usr/bin/env node
import esbuild from "esbuild";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(import.meta.dirname, "..");
const entry = path.join(root, "src", "index.js");
const targets = [
  path.join(root, ".opencode", "skills", "ai-code-tracker", "scripts", "bundle.js"),
  path.join(root, ".claude", "skills", "ai-code-tracker", "scripts", "bundle.js"),
];

// 单次 build，多次写出
const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
});

const code = result.outputFiles[0].text;
for (const out of targets) {
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, code);
}
```

（单次 `esbuild.build` 产出文本，再写两份目标，避免重复打包。）

调用：`node scripts/build.js`。开发流程：改 `src/` → `npm run build` → 提交（替代当前手动 `cp -r src/ lib/`）。

### 3. Wrapper 改动

6 个 wrapper 只改 import 路径，逻辑不动。示例：

```js
// scripts/commit-stats.js
#!/usr/bin/env node
import { runCommitStats } from "./bundle.js";   // 原 "../lib/cli/commit-stats.js"

runCommitStats(process.argv[2]).catch((error) => {
  console.error(`[ai-code-tracker] ${error.message}`);
  process.exitCode = 1;
});
```

`opencode-plugin.js` 同理：

```js
export { AiCodeTrackerPlugin, recordEditedFile } from "./bundle.js";
```

`.opencode/plugins/ai-code-tracker.js`（install 时注入的插件入口）若从 skill 的 `scripts/opencode-plugin.js` 转发，链路保持不变。

### 4. `lib/` 目录删除

删除：

- `.opencode/skills/ai-code-tracker/lib/`（整树）
- `.claude/skills/ai-code-tracker/lib/`（整树）

### 5. `src/tracker/updater.js` 改动（升级流程）

当前 `downloadAndUpgrade`（updater.js:117-203）：

1. 下载 release tarball → 解压（`--strip-components=1`）
2. `extractDir/src` → `skillDest/lib`（updater.js:141-144）← **删除这段**
3. 从 release 的 `scripts/` 拷 6 个 wrapper（updater.js:146-156，`scriptsToCopy` 数组）← 数组加 `"bundle.js"`
4. 拷 `commands/`、`SKILL.md`，同步 `.claude`，跑 `install.js` ← 不变

改动后 `scriptsToCopy`：

```js
const scriptsToCopy = ["ai-update.js", "install.js", "commit-stats.js", "claude-code-hook.js", "ai-code-stats.js", "opencode-plugin.js", "bundle.js"];
```

release tarball（= 仓库内容）里 `bundle.js` 已提交在 `.opencode/skills/ai-code-tracker/scripts/bundle.js`，经 `scriptsToCopy` 自动流转到目标项目。

**新增：清理旧 `lib/` 残留。** 上述改动只移除了"把 src 复制到 lib"的步骤，但**不会删除**目标 skill 目录里旧版本遗留的 `lib/` 树（16 个文件）。残留 `lib/` 不被引用、无功能影响，但违背"减文件数"目标（升级后会是 14 + 16 = 30 文件）。

注意 `fs.cp(skillDest, claudeSkillDest, { recursive: true, force: true })`（第 170 行）**只覆盖同名路径，不会删除目标侧多余的文件**。因此仅删 `.opencode` 侧的 `lib/` 不足以清除 `.claude` 侧的旧 `lib/`。必须在同步之前分别显式删除两侧 `lib/`。

改动后 `downloadAndUpgrade` 的步骤序列：

1. 下载 release tarball → 解压（`--strip-components=1`）
2. **删除** `skillDest/lib`（`.opencode` 侧旧 `lib/`）
3. 从 release 的 `scripts/` 拷 wrapper（含 `bundle.js`）到 `skillDest/scripts/`
4. 拷 `commands/`、`SKILL.md`
5. **删除** `claudeSkillDest/lib`（`.claude` 侧旧 `lib/`，若存在）— 必须显式删，`fs.cp` 不会清理
6. `fs.cp(skillDest, claudeSkillDest)` 同步到 `.claude`
7. 跑 `install.js`

对应新增代码：

```js
// 第 2 步：删 .opencode 侧 lib/
const libDest = path.join(skillDest, "lib");
await fs.rm(libDest, { recursive: true, force: true });

// 第 5 步：删 .claude 侧 lib/（在 fs.cp 同步之前）
const claudeLibDest = path.join(claudeSkillDest, "lib");
await fs.rm(claudeLibDest, { recursive: true, force: true });
```

`fs.rm` 的 `force: true` 保证新装项目或 `.claude` 不存在时不报错。两处删除均在 `fs.cp(skillDest, claudeSkillDest)` 之前完成。

### 6. `package.json` 改动

- `scripts` 加 `"build": "node scripts/build.js"`
- `devDependencies` 加 `"esbuild": "^0.23.0"`（版本以实际安装为准）

### 7. 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/index.js` | 新增 | barrel 入口，聚合 6 个 wrapper 所需符号 |
| `scripts/build.js` | 新增 | esbuild 构建脚本，输出 bundle.js 到两个 skill 目录 |
| `package.json` | 修改 | 加 `build` script 与 `esbuild` devDependency |
| `.opencode/skills/ai-code-tracker/scripts/bundle.js` | 新增 | 构建产物（已提交） |
| `.claude/skills/ai-code-tracker/scripts/bundle.js` | 新增 | 构建产物（已提交） |
| `.opencode/skills/ai-code-tracker/scripts/*.js`（6 个 wrapper） | 修改 | import 路径 `../lib/...` → `./bundle.js` |
| `.claude/skills/ai-code-tracker/scripts/*.js`（6 个 wrapper） | 修改 | 同上 |
| `.opencode/skills/ai-code-tracker/lib/` | 删除 | 整树 |
| `.claude/skills/ai-code-tracker/lib/` | 删除 | 整树 |
| `src/tracker/updater.js` | 修改 | 删 `src`→`lib` 复制段；`scriptsToCopy` 加 `bundle.js`；新增 `fs.rm(lib)` 清理旧残留 |
| `src/tracker/updater.js`（部署副本） | 修改 | 同步到 `.opencode`/`.claude` 的 bundle 内 |

注：`updater.js` 本身是 `src/` 源文件，改动后会随 `npm run build` 打进 `bundle.js`，因此部署副本随 bundle 一起更新，无需单独同步 `lib/tracker/updater.js`。

### 8. 文件数对比

| | 改前（每 skill 目录） | 改后 |
|---|---|---|
| lib 实现 | 16 | 0（`lib/` 删除） |
| bundle | 0 | 1（`scripts/bundle.js`） |
| wrapper | 6 | 6（改 import） |
| **合计** | **22** | **7** |

×2 skill 目录 = 44 → 14 个部署 JS 文件。

### 9. 向下兼容

- `install-to-project.js` 拷整个 skill 目录，自动带上 `bundle.js` 而非 `lib/`，**无需改**
- 测试继续从 `../src/...` 直接导入源码，**不变**
- git hook 命令串、claude-code settings、`.opencode/plugins/ai-code-tracker.js` 路径均不变（仍指向 `scripts/<wrapper>.js`）
- 旧版本已安装项目升级到新版本时：`updater` 从 release 取 `bundle.js`（在 `scriptsToCopy` 中），不再复制 `lib/`；旧 `lib/` 目录残留在 backup 中，升级后目标 skill 目录无 `lib/`，wrapper 指向 `bundle.js`，正常工作

### 10. 测试

- 现有测试（`test/`）从 `../src/...` 导入，**不依赖 bundle**，继续直接测源码，无需改
- 新增 `test/bundle.test.js`：导入构建产物 `bundle.js`，断言 7 个符号均可解析（`runCommitStats`、`runAiCodeStats`、`runAiCodeUpdate`、`runInstall`、`runClaudeCodeHook`、`AiCodeTrackerPlugin`、`recordEditedFile`），保证 bundle 与 barrel 一致、不漏导出
- 构建脚本本身不单独测（产物由 bundle.test.js 间接验证）

## 风险

- **esbuild 依赖引入**：项目从零依赖变为有一个 devDependency。esbuild 仅 dev 时使用，不进入运行时；release tarball 含预构建 `bundle.js`，目标项目无需安装 esbuild。可接受。
- **bundle 与 src 漂移**：开发者改 `src/` 后忘记 `npm run build` 会导致提交的 `bundle.js` 过期。缓解：`bundle.test.js` 验证符号存在；可在 pre-commit hook 加 `npm run build`（本设计不强制，列为可选）。
- **ESM 默认导出**：`opencode/ai-code-tracker.js` 有 `export default AiCodeTrackerPlugin`。barrel 只显式重导出命名导出，默认导出**不**经 barrel 转出，因此 `bundle.js` 不含默认导出（esbuild 按可达性 tree-shake）。当前所有 wrapper 只用命名导入，无影响；未来若有消费者需要默认导出，须直接导入 `src/opencode/ai-code-tracker.js` 或在 barrel 中显式 `export { default } from "./opencode/ai-code-tracker.js"`。
