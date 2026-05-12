import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { atomicWriteJson, atomicWriteText, withFileLock } from "../src/tracker/lock.js";

test("atomicWriteJson writes valid JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-lock-"));
  const file = path.join(dir, "data.json");

  await atomicWriteJson(file, { ok: true });

  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { ok: true });
});

test("withFileLock times out when lock exists", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-lock-"));
  const lock = path.join(dir, "held.lock");
  await fs.writeFile(lock, "held", "utf8");

  await assert.rejects(
    withFileLock(lock, async () => "nope", { timeoutMs: 20, pollMs: 5 }),
    /Timed out waiting for lock/,
  );
});

test("withFileLock writes recovery log when lock exists", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-lock-"));
  const lock = path.join(repoRoot, ".ai-tracking", "pending-lines.lock");
  await fs.mkdir(path.dirname(lock), { recursive: true });
  await fs.writeFile(lock, "held", "utf8");

  await assert.rejects(
    withFileLock(lock, async () => "nope", {
      operation: "record pending AI lines",
      timeoutMs: 20,
      pollMs: 5,
    }),
    /Timed out waiting for lock/,
  );

  const log = await fs.readFile(path.join(repoRoot, ".ai-tracking", "errors.log"), "utf8");
  assert.match(log, /record pending AI lines/);
  assert.match(log, /pending-lines\.lock/);
  assert.match(log, /retry the same opencode edit or git action/);
});

test("atomicWriteText writes recovery log when temp file write fails", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-lock-"));
  const target = path.join(repoRoot, ".ai-tracking", "tracking-message.txt");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.mkdir(`${target}.${process.pid}.blocked.tmp`, { recursive: true });

  await assert.rejects(
    atomicWriteText(target, "message\n", {
      operation: "write tracking commit message",
      tempSuffix: `${process.pid}.blocked.tmp`,
    }),
  );

  const log = await fs.readFile(path.join(repoRoot, ".ai-tracking", "errors.log"), "utf8");
  assert.match(log, /write tracking commit message/);
  assert.match(log, /tracking-message\.txt/);
  assert.match(log, /retry the same opencode edit or git action/);
});
