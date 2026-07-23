import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadUploadOutbox, runPushUpload, saveUploadOutbox } from "../src/tracker/pushUpload.js";

async function fakeRepo(uploadUrl = "") {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-upload-"));
  await fs.mkdir(path.join(repoRoot, ".ai-tracking"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, ".ai-tracking", "config.json"), JSON.stringify({ enabled: true, uploadUrl }), "utf8");
  return repoRoot;
}

const record = { author: "dev", ai_lines: 1, total_lines: 2, is_ai_commit: true, commit_id: "a".repeat(40), date: "2026-07-20 10:00:00", message: "feat: demo" };

test("does nothing when uploadUrl is empty", async () => {
  const repoRoot = await fakeRepo();
  const result = await runPushUpload({ repoRoot, fetchImpl: async () => assert.fail("fetch must not run") });
  assert.deepEqual(result, { skipped: "upload-disabled" });
});

test("retries outbox before newly pushed records", async () => {
  const repoRoot = await fakeRepo("http://tracker.test/v1/records");
  const oldRecord = { ...record, commit_id: "b".repeat(40) };
  await saveUploadOutbox(repoRoot, [{ repository_url: "github.com/acme/demo", records: [oldRecord] }]);
  const sent = [];
  const result = await runPushUpload({
    repoRoot,
    stdin: `refs/heads/main ${record.commit_id} refs/heads/main ${"0".repeat(40)}\n`,
    readRecordsImpl: async () => [record],
    gitRawImpl: async (args) => args[0] === "remote" ? "git@github.com:acme/demo.git\n" : `${record.commit_id}\n`,
    fetchImpl: async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; },
  });
  assert.deepEqual(sent.map((batch) => batch.records), [[oldRecord], [record]]);
  assert.equal(result.uploaded, 2);
});

test("keeps only the failed outbox batch and returns its HTTP error", async () => {
  const repoRoot = await fakeRepo("http://tracker.test/v1/records");
  const firstBatch = { repository_url: "github.com/acme/demo", records: [{ ...record, commit_id: "b".repeat(40) }] };
  const failedBatch = { repository_url: "github.com/acme/demo", records: [{ ...record, commit_id: "c".repeat(40) }] };
  await saveUploadOutbox(repoRoot, [firstBatch, failedBatch]);
  let attempts = 0;

  const result = await runPushUpload({
    repoRoot,
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1 ? { ok: true } : { ok: false, status: 503, statusText: "Service Unavailable" };
    },
  });

  assert.deepEqual(result, { uploaded: 1, queued: 1, error: "HTTP 503 Service Unavailable" });
  assert.deepEqual(await loadUploadOutbox(repoRoot), [failedBatch]);
});
