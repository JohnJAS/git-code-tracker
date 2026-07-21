import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { runUploadSmokeTest } from "../scripts/upload-smoke.js";

test("upload smoke test uploads a CSV record for a real Git commit", async (t) => {
  let received;
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      received = { method: request.method, path: request.url, body: JSON.parse(body) };
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"received":1,"inserted":1,"duplicates":0}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const result = await runUploadSmokeTest({ uploadURL: `http://127.0.0.1:${address.port}/v1/records` });

  assert.equal(result.uploaded, 1);
  assert.equal(received.method, "POST");
  assert.equal(received.path, "/v1/records");
  assert.equal(received.body.repository_url, "https://github.com/ai-code-tracker/upload-smoke.git");
  assert.equal(received.body.records.length, 1);
  assert.equal(received.body.records[0].commit_id, result.commitID);
  assert.match(received.body.records[0].commit_id, /^[0-9a-f]{40}$/);
});
