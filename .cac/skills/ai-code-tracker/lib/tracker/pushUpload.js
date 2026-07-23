import fs from "node:fs/promises";
import path from "node:path";
import { readRecords } from "./csv.js";
import { gitRaw, gitRepoRoot } from "./git.js";
import { uploadOutboxPath } from "./paths.js";
import { loadConfig } from "./shared.js";

const ZERO_SHA = /^0+$/;

export async function runPushUpload({ cwd = process.cwd(), repoRoot, stdin = "", fetchImpl = globalThis.fetch, gitRawImpl = gitRaw, readRecordsImpl = readRecords } = {}) {
  const root = repoRoot ?? await gitRepoRoot(cwd);
  const config = await loadConfig(root);
  if (!config.uploadUrl) return { skipped: "upload-disabled" };

  let uploaded = 0;
  const pending = await loadUploadOutbox(root);
  for (let index = 0; index < pending.length; index += 1) {
    const batch = pending[index];
    const response = await postBatch(config.uploadUrl, batch, fetchImpl);
    if (response.ok) {
      uploaded += batch.records.length;
      continue;
    }
    const queuedBatches = pending.slice(index);
    await saveUploadOutbox(root, queuedBatches);
    return { uploaded, queued: queuedBatches.length, error: response.error };
  }
  await saveUploadOutbox(root, []);

  const commitIDs = await pushedCommitIDs(stdin, root, gitRawImpl);
  if (commitIDs.size === 0) return { uploaded };
  const records = (await readRecordsImpl(root)).filter((record) => commitIDs.has(record.commit_id));
  if (records.length === 0) return { uploaded };
  const repositoryURL = (await gitRawImpl(["remote", "get-url", "origin"], { cwd: root })).trim();
  const batch = { repository_url: repositoryURL, records };
  const response = await postBatch(config.uploadUrl, batch, fetchImpl);
  if (response.ok) return { uploaded: uploaded + records.length };
  await saveUploadOutbox(root, [batch]);
  return { uploaded, queued: 1, error: response.error };
}

async function pushedCommitIDs(stdin, repoRoot, gitRawImpl) {
  const ids = new Set();
  for (const line of String(stdin).split(/\r?\n/)) {
    const [, localSHA, , remoteSHA] = line.trim().split(/\s+/);
    if (!localSHA || ZERO_SHA.test(localSHA)) continue;
    const args = ZERO_SHA.test(remoteSHA ?? "") ? ["rev-list", localSHA] : ["rev-list", localSHA, `^${remoteSHA}`];
    const output = await gitRawImpl(args, { cwd: repoRoot });
    for (const id of output.split(/\r?\n/)) if (id) ids.add(id);
  }
  return ids;
}

async function postBatch(url, batch, fetchImpl) {
  try {
    const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batch) });
    if (response.ok) return { ok: true };
    const details = [response.status, response.statusText].filter(Boolean).join(" ");
    return { ok: false, error: `HTTP ${details || "request failed"}` };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

export async function loadUploadOutbox(repoRoot) {
  try { return JSON.parse(await fs.readFile(uploadOutboxPath(repoRoot), "utf8")); } catch { return []; }
}

export async function saveUploadOutbox(repoRoot, batches) {
  const file = uploadOutboxPath(repoRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (batches.length === 0) { await fs.rm(file, { force: true }); return; }
  await fs.writeFile(file, `${JSON.stringify(batches)}\n`, "utf8");
}
