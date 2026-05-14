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
    "src/a.js": [{ content: "two", consumed: false }],
  });
});

test("records all lines as added when before snapshot is missing (new file)", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-plugin-"));
  await execFileAsync("git", ["init"], { cwd: repoRoot });
  await fs.mkdir(path.join(repoRoot, ".ai-tracking"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, ".ai-tracking", "config.json"), JSON.stringify({ enabled: true, ignore: [] }), "utf8");

  const result = await recordEditedFile({
    cwd: repoRoot,
    filePath: "src/a.js",
    after: "one\ntwo\n",
  });

  assert.deepEqual(result, { recorded: 3 });
  assert.deepEqual(await loadPendingLines(repoRoot), {
    "src/a.js": [
      { content: "one", consumed: false },
      { content: "two", consumed: false },
    ],
  });
});

test("records all lines as added when before snapshot is empty (new file)", async () => {
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

  assert.deepEqual(result, { recorded: 3 });
  assert.deepEqual(await loadPendingLines(repoRoot), {
    "src/a.js": [
      { content: "one", consumed: false },
      { content: "two", consumed: false },
    ],
  });
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
    "src/b.js": [{ content: "two", consumed: false }],
  });
});

test("plugin records all lines when Write creates a new file", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-plugin-"));
  await execFileAsync("git", ["init"], { cwd: repoRoot });
  await fs.mkdir(path.join(repoRoot, ".ai-tracking"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, ".ai-tracking", "config.json"), JSON.stringify({ enabled: true, ignore: [] }), "utf8");

  const plugin = await AiCodeTrackerPlugin({ directory: repoRoot });

  await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
  // file does not exist yet — safeRead returns ""
  await plugin["tool.execute.before"]({
    tool: "write",
    args: {
      filePath: "src/new.js",
    },
  });
  // Write tool creates the file
  await fs.writeFile(path.join(repoRoot, "src/new.js"), "line1\nline2\n", "utf8");
  await plugin["tool.execute.after"]({
    tool: "write",
    args: {
      filePath: "src/new.js",
    },
  });

  assert.deepEqual(await loadPendingLines(repoRoot), {
    "src/new.js": [
      { content: "line1", consumed: false },
      { content: "line2", consumed: false },
    ],
  });
});
