import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AiCodeTrackerPlugin, recordEditedFile } from "../src/opencode/ai-code-tracker.js";
import { loadPendingLines } from "../src/tracker/lineStore.js";

const execFileAsync = promisify(execFile);

test("records added lines for edited file", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-plugin-"));
  await execFileAsync("git", ["init"], { cwd: repoRoot });
  await fs.mkdir(path.join(repoRoot, ".ai-tracking"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, ".ai-tracking", "config.json"), JSON.stringify({ enabled: true, ignore: [] }), "utf8");

  await recordEditedFile({
    cwd: repoRoot,
    filePath: "src/a.js",
    before: "one\n",
    after: "one\ntwo\n",
  });

  assert.deepEqual(await loadPendingLines(repoRoot), {
    "src/a.js": ["two"],
  });
});

test("skips recording when before snapshot is missing", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-plugin-"));
  await execFileAsync("git", ["init"], { cwd: repoRoot });
  await fs.mkdir(path.join(repoRoot, ".ai-tracking"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, ".ai-tracking", "config.json"), JSON.stringify({ enabled: true, ignore: [] }), "utf8");

  const result = await recordEditedFile({
    cwd: repoRoot,
    filePath: "src/a.js",
    after: "one\ntwo\n",
  });

  assert.deepEqual(result, { skipped: "missing-before-snapshot" });
  assert.deepEqual(await loadPendingLines(repoRoot), {});
});

test("skips recording when before snapshot is empty", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-plugin-"));
  await execFileAsync("git", ["init"], { cwd: repoRoot });
  await fs.mkdir(path.join(repoRoot, ".ai-tracking"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, ".ai-tracking", "config.json"), JSON.stringify({ enabled: true, ignore: [] }), "utf8");

  const result = await recordEditedFile({
    cwd: repoRoot,
    filePath: "src/a.js",
    before: "",
    after: "one\ntwo\n",
  });

  assert.deepEqual(result, { skipped: "empty-before-snapshot" });
  assert.deepEqual(await loadPendingLines(repoRoot), {});
});

test("plugin exposes opencode hook object and records tool before/after events", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-plugin-"));
  await execFileAsync("git", ["init"], { cwd: repoRoot });
  await fs.mkdir(path.join(repoRoot, ".ai-tracking"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, ".ai-tracking", "config.json"), JSON.stringify({ enabled: true, ignore: [] }), "utf8");

  const plugin = await AiCodeTrackerPlugin({ directory: repoRoot });

  assert.equal(typeof plugin.event, "function");
  assert.equal(typeof plugin["tool.execute.before"], "function");
  assert.equal(typeof plugin["tool.execute.after"], "function");

  await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "src/b.js"), "one\n", "utf8");
  await plugin["tool.execute.before"]({
    tool: "write",
    args: {
      filePath: "src/b.js",
    },
  });
  await fs.writeFile(path.join(repoRoot, "src/b.js"), "one\ntwo\n", "utf8");
  await plugin["tool.execute.after"]({
    tool: "write",
    args: {
      filePath: "src/b.js",
    },
  });

  assert.deepEqual(await loadPendingLines(repoRoot), {
    "src/b.js": ["two"],
  });
});
