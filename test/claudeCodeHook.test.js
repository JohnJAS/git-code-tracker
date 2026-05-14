import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runClaudeCodeHook } from "../src/cli/claude-code-hook.js";
import { loadPendingLines } from "../src/tracker/lineStore.js";
import { snapshotDir } from "../src/tracker/paths.js";

const execFileAsync = promisify(execFile);

async function fakeRepo() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-claude-"));
  await execFileAsync("git", ["init"], { cwd: repoRoot });
  await fs.mkdir(path.join(repoRoot, ".ai-tracking"), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, ".ai-tracking", "config.json"),
    JSON.stringify({ enabled: true, ignore: [], count_blank_lines: false }),
    "utf8",
  );
  return repoRoot;
}

function preInput(repoRoot, filePath, toolUseId = "toolu_001") {
  return JSON.stringify({
    cwd: repoRoot,
    tool_name: "Edit",
    tool_input: { file_path: path.resolve(repoRoot, filePath) },
    tool_use_id: toolUseId,
    hook_event_name: "PreToolUse",
  });
}

function postInput(repoRoot, filePath, toolUseId = "toolu_001") {
  return JSON.stringify({
    cwd: repoRoot,
    tool_name: "Edit",
    tool_input: { file_path: path.resolve(repoRoot, filePath) },
    tool_use_id: toolUseId,
    hook_event_name: "PostToolUse",
  });
}

test("pre hook stores snapshot to disk", async () => {
  const repoRoot = await fakeRepo();
  await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "src", "a.js"), "one\n", "utf8");

  await runClaudeCodeHook("pre", { stdin: preInput(repoRoot, "src/a.js") });

  const snapshot = JSON.parse(await fs.readFile(path.join(snapshotDir(repoRoot), "toolu_001.json"), "utf8"));
  assert.equal(snapshot.content, "one\n");
  assert.equal(snapshot.filePath, "src/a.js");
});

test("post hook reads snapshot and records added lines", async () => {
  const repoRoot = await fakeRepo();
  await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "src", "a.js"), "one\n", "utf8");

  await runClaudeCodeHook("pre", { stdin: preInput(repoRoot, "src/a.js", "toolu_002") });

  await fs.writeFile(path.join(repoRoot, "src", "a.js"), "one\ntwo\nthree\n", "utf8");

  await runClaudeCodeHook("post", { stdin: postInput(repoRoot, "src/a.js", "toolu_002") });

  assert.deepEqual(await loadPendingLines(repoRoot), {
    "src/a.js": [{ content: "two", consumed: false }, { content: "three", consumed: false }],
  });

  await assert.rejects(fs.access(path.join(snapshotDir(repoRoot), "toolu_002.json")));
});

test("post hook is graceful when snapshot is missing", async () => {
  const repoRoot = await fakeRepo();
  await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "src", "a.js"), "content\n", "utf8");

  await runClaudeCodeHook("post", { stdin: postInput(repoRoot, "src/a.js", "toolu_nosnap") });

  assert.deepEqual(await loadPendingLines(repoRoot), {});
});

test("hook skips disabled config", async () => {
  const repoRoot = await fakeRepo();
  await fs.writeFile(
    path.join(repoRoot, ".ai-tracking", "config.json"),
    JSON.stringify({ enabled: false, ignore: [] }),
    "utf8",
  );
  await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "src", "a.js"), "one\n", "utf8");

  await runClaudeCodeHook("pre", { stdin: preInput(repoRoot, "src/a.js") });

  const dir = snapshotDir(repoRoot);
  let entries;
  try { entries = await fs.readdir(dir); } catch { entries = []; }
  assert.equal(entries.length, 0);
});

test("hook skips ignored file paths", async () => {
  const repoRoot = await fakeRepo();
  await fs.writeFile(
    path.join(repoRoot, ".ai-tracking", "config.json"),
    JSON.stringify({ enabled: true, ignore: ["node_modules/**"], count_blank_lines: false }),
    "utf8",
  );
  await fs.mkdir(path.join(repoRoot, "node_modules"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "node_modules", "pkg.js"), "code\n", "utf8");

  await runClaudeCodeHook("pre", { stdin: preInput(repoRoot, "node_modules/pkg.js") });

  const dir = snapshotDir(repoRoot);
  let entries;
  try { entries = await fs.readdir(dir); } catch { entries = []; }
  assert.equal(entries.length, 0);
});

test("hook normalizes Windows backslash paths to forward slashes", async () => {
  const repoRoot = await fakeRepo();
  await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "src", "a.js"), "one\r\n", "utf8");

  const winInput = JSON.stringify({
    cwd: repoRoot.replace(/\//g, "\\"),
    tool_name: "Edit",
    tool_input: { file_path: path.resolve(repoRoot, "src/a.js").replace(/\//g, "\\") },
    tool_use_id: "toolu_win",
    hook_event_name: "PreToolUse",
  });

  await runClaudeCodeHook("pre", { stdin: winInput });

  const snapshot = JSON.parse(await fs.readFile(path.join(snapshotDir(repoRoot), "toolu_win.json"), "utf8"));
  assert.equal(snapshot.filePath, "src/a.js");
  assert.equal(snapshot.content, "one\r\n");
});

test("hook handles CRLF line endings in file content", async () => {
  const repoRoot = await fakeRepo();
  await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "src", "a.js"), "one\r\n", "utf8");

  await runClaudeCodeHook("pre", { stdin: preInput(repoRoot, "src/a.js", "toolu_crlf") });

  await fs.writeFile(path.join(repoRoot, "src", "a.js"), "one\r\ntwo\r\nthree\r\n", "utf8");

  await runClaudeCodeHook("post", { stdin: postInput(repoRoot, "src/a.js", "toolu_crlf") });

  const pending = await loadPendingLines(repoRoot);
  assert.ok(pending["src/a.js"].length > 0);
  assert.ok(pending["src/a.js"].some((e) => e.content === "two"));
  assert.ok(pending["src/a.js"].some((e) => e.content === "three"));
});

test("stale snapshots are cleaned up on pre invocation", async () => {
  const repoRoot = await fakeRepo();
  const dir = snapshotDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });

  await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "src", "a.js"), "one\n", "utf8");
  await fs.writeFile(path.join(repoRoot, "src", "b.js"), "one\n", "utf8");

  const staleSnapshot = { content: "old\n", filePath: "src/old.js", timestamp: Date.now() - 15 * 60 * 1000 };
  await fs.writeFile(path.join(dir, "toolu_stale.json"), JSON.stringify(staleSnapshot), "utf8");

  const now = Date.now();
  const staleTime = new Date(now - 15 * 60 * 1000);
  await fs.utimes(path.join(dir, "toolu_stale.json"), staleTime, staleTime);

  await runClaudeCodeHook("pre", { stdin: preInput(repoRoot, "src/a.js", "toolu_fresh") });

  const entries = await fs.readdir(dir);
  assert.ok(!entries.includes("toolu_stale.json"));
  assert.ok(entries.includes("toolu_fresh.json"));
});
