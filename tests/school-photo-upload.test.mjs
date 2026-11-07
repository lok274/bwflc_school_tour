import test from "node:test";
import assert from "node:assert/strict";
import { createSchoolPhotoUpload, PHOTO_UPLOAD_DEADLINE, PHOTO_UPLOAD_ENDPOINT } from "../src/school-photo-upload.js";
const file = (index = 1, size = 12) => new File([new Uint8Array(size)], `photo-${index}.jpg`, { type: "image/jpeg" });
const ticket = metadata => ({ ...metadata, fileId: "synthetic-file-0001", signature: "fake-only", expiresAt: PHOTO_UPLOAD_DEADLINE });
const environment = { crypto: globalThis.crypto, location: { origin: "https://lok274.github.io" }, navigator: { onLine: true } };
function receiver() {
  const calls = [], offsets = new Map();
  let fail = false;
  return { calls, offsets, fail: () => { fail = true; }, async send(method, args) {
    calls.push({ method, args });
    assert.equal(args[0], "fixture-code");
    if (method === "prepareUpload") return ticket(args[1]);
    const entry = args[1], key = entry.uploadKey;
    if (method === "uploadChunk") {
      offsets.set(key, args[2] + Buffer.from(args[3], "base64").length);
      if (fail) { fail = false; throw Error("uncertain response fixture-code"); }
    }
    const offset = offsets.get(key) || 0;
    return { status: offset === entry.size ? "saved" : "uploading", offset };
  } };
}
test("upload protocol: prefix SHA, 4 MiB chunks, exact saved receipt and private model", async () => {
  const r = receiver();
  const upload = createSchoolPhotoUpload({ environment, transport: r.send });
  await upload.start([file(1, 4 * 1024 * 1024 + 7)], "fixture-code");
  assert.deepEqual(r.calls.map(call => call.method), ["prepareUpload", "getUploadStatus", "uploadChunk", "uploadChunk"]);
  const meta = r.calls[0].args[1];
  assert.equal(meta.prefixSha256.length, 64); assert.equal(meta.uploadKey.length, 32);
  assert.equal(Buffer.from(r.calls[0].args[2], "base64").length, 65536);
  assert.equal(r.calls[3].args[2], 4 * 1024 * 1024);
  assert.equal(upload.getModel().rows[0].state, "saved");
  assert.doesNotMatch(JSON.stringify(upload.getModel()), /fixture-code|signature|ticket|uploadKey|prefixSha|Blob/);
  assert.throws(() => { upload.getModel().rows[0].state = "failed"; });
});
test("independent album sends canonical MIME and generated names; legacy album still rejects video", async () => {
  const r = receiver();
  const files = [
    { blob: new Blob([new Uint8Array(4 * 1024 ** 2 + 7)]), mime: "video/quicktime", name: "video-1.mov" },
    { blob: new Blob([new Uint8Array(16)]), mime: "image/heic", name: "photo-2.heic" }
  ];
  const upload = createSchoolPhotoUpload({ environment, mediaEnabled: true, transport: r.send });
  await assert.rejects(upload.start([{ ...files[0], name: "private-name.mov" }], "fixture-code"), /已準備/);
  await assert.rejects(createSchoolPhotoUpload({ environment, transport: r.send }).start(files, "fixture-code"), /JPEG/);
  r.fail();
  await upload.start(files, "fixture-code");
  assert.equal(upload.getModel().rows[0].state, "failed");
  await upload.retry("fixture-code");
  assert.deepEqual(upload.getModel().rows.map(row => row.state), ["saved", "saved"]);
  assert.deepEqual(r.calls.filter(call => call.method === "prepareUpload").map(call => [call.args[1].name, call.args[1].mime]),
    [["video-1.mov", "video/quicktime"], ["photo-2.heic", "image/heic"]]);
});
test("uncertain chunk acknowledgement: no automatic replay; manual retry reconciles and skips saved", async () => {
  const r = receiver(); r.fail();
  const upload = createSchoolPhotoUpload({ environment, transport: r.send });
  await upload.start([file(1), file(2)], "fixture-code");
  assert.equal(upload.getModel().rows[0].state, "failed");
  assert.doesNotMatch(JSON.stringify(upload.getModel()), /fixture-code/);
  assert.equal(r.calls.length, 3);
  const key = r.calls[0].args[1].uploadKey;
  await upload.retry("fixture-code");
  assert.equal(r.calls[3].method, "getUploadStatus");
  assert.equal(r.calls[3].args[1].uploadKey, key);
  assert.equal(upload.getModel().rows.filter(row => row.state === "saved").length, 2);
  const count = r.calls.length; await upload.retry("fixture-code"); assert.equal(r.calls.length, count);
});
test("lost prepare response retries identical metadata/key and fixed code", async () => {
  const r = receiver(); let first = true;
  const upload = createSchoolPhotoUpload({ environment, transport: async (method, args) => {
    const reply = await r.send(method, args);
    if (first) { first = false; throw Error("lost"); } return reply;
  } });
  await upload.start([file()], "fixture-code"); await upload.retry("fixture-code");
  assert.deepEqual(r.calls[0].args, r.calls[1].args);
});
test("wrong auth stops batch without exposing service errors or advancing receipts", async () => {
  let calls = 0;
  const upload = createSchoolPhotoUpload({ environment, transport: async () => { calls++; throw Error("invalid fixture-code"); } });
  await upload.start([file(), file(2)], "fixture-code");
  assert.equal(calls, 1); assert.equal(upload.getModel().rows[0].offset, 0);
  assert.equal(upload.getModel().rows[1].state, "queued");
  assert.doesNotMatch(JSON.stringify(upload.getModel()), /fixture-code/);
});
test("saved requires exact length and valid ticket; receipt regression fails closed", async () => {
  for (const receipt of [{ status: "saved", offset: 1 }, { status: "uploading", offset: 12 }, { status: "saved", offset: "12" }]) {
    const upload = createSchoolPhotoUpload({ environment, transport: async (method, args) => method === "prepareUpload" ? ticket(args[1]) : receipt });
    await upload.start([file()], "fixture-code"); assert.equal(upload.getModel().rows[0].state, "failed");
  }
  let calls = 0;
  const upload = createSchoolPhotoUpload({ environment, transport: async () => { calls++; return {}; } });
  await upload.start([file()], "fixture-code"); assert.equal(calls, 1);
});
test("batch boundary, blank code, local/offline/rehearsal and cutoff never send", async () => {
  for (const config of [{ environment: { ...environment, location: { origin: "http://localhost" } } },
    { environment: { ...environment, navigator: { onLine: false } } }, { environment, enabled: false }]) {
    await assert.rejects(createSchoolPhotoUpload(config).start([file()], "fixture-code"), /預覽/);
  }
  let calls = 0;
  const config = { environment, transport: async () => { calls++; } };
  await assert.rejects(createSchoolPhotoUpload(config).start(Array.from({ length: 31 }, (_, i) => file(i)), "fixture-code"), /30/);
  await assert.rejects(createSchoolPhotoUpload(config).start([file()], " "), /上傳碼/);
  const now = Date.now; Date.now = () => PHOTO_UPLOAD_DEADLINE;
  try { await assert.rejects(createSchoolPhotoUpload(config).start([file()], "fixture-code"), /截止/); }
  finally { Date.now = now; }
  assert.equal(calls, 0);
});
test("cancel or expired source during prepare prevents every later request and publication", async () => {
  for (const cancel of [true, false]) {
    let release, valid = true, count = 0; const models = [];
    const upload = createSchoolPhotoUpload({ environment, isCurrent: () => valid, onChange: value => models.push(value),
      transport: async (_, args) => { count++; return new Promise(resolve => { release = () => resolve(ticket(args[1])); }); } });
    const run = upload.start([file()], "fixture-code");
    while (!release) await new Promise(resolve => setImmediate(resolve));
    if (cancel) upload.cancel(); else valid = false;
    const published = models.length; release(); await run;
    assert.equal(count, 1); assert.equal(models.length, published);
  }
});
const redirectUrl = "https://script.googleusercontent.com/macros/echo?user_content_key=synthetic";
function network({ send = receiver().send, respond = reply => ({ text: async () => JSON.stringify(reply) }) } = {}) {
  const requests = [], timers = new Map();
  let nextTimer = 0;
  const window = { setTimeout(fn, ms) { assert.equal(ms, 120000); timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); } };
  return { requests, timers, environment: { ...environment, window, fetch: async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push({ url, options, request });
    const result = await send(request.method, request.args);
    return { url: redirectUrl, type: "cors", ok: true, ...await respond({ id: request.id, method: request.method, ok: true, result }) };
  } } };
}
async function until(predicate) {
  for (let n = 0; n < 100 && !predicate(); n++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), "request reached expected boundary");
}
test("fetch JSON uses fixed CORS endpoint, fresh nonce, private body and same domain protocol", async () => {
  const r = receiver(), n = network({ send: r.send });
  const upload = createSchoolPhotoUpload({ environment: n.environment });
  await upload.start([file()], "fixture-code");
  assert.equal(upload.getModel().rows[0].state, "saved");
  assert.deepEqual(r.calls.map(call => call.method), ["prepareUpload", "getUploadStatus", "uploadChunk"]);
  const ids = new Set();
  for (const { url, options, request } of n.requests) {
    assert.equal(url, PHOTO_UPLOAD_ENDPOINT);
    assert.match(request.id, /^[a-f0-9]{32}$/); ids.add(request.id);
    assert.deepEqual(Object.keys(request).sort(), ["args", "id", "method"]);
    assert.equal(options.method, "POST"); assert.equal(options.mode, "cors");
    assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "follow");
    assert.equal(options.cache, "no-store"); assert.equal(options.referrerPolicy, "no-referrer");
    assert.deepEqual(options.headers, { "Content-Type": "text/plain;charset=UTF-8" });
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(ids.size, 3); assert.equal(n.timers.size, 0);
  assert.doesNotMatch(JSON.stringify(upload.getModel()), /fixture-code|signature|uploadKey/);
});
test("fetch accepts exact receiver URL or exact Google JSON redirect and rejects foreign URLs immediately", async () => {
  for (const url of [PHOTO_UPLOAD_ENDPOINT, redirectUrl]) {
    const n = network({ respond: reply => ({ url, text: async () => JSON.stringify(reply) }) });
    const upload = createSchoolPhotoUpload({ environment: n.environment });
    await upload.start([file()], "fixture-code");
    assert.equal(upload.getModel().rows[0].state, "saved"); assert.equal(n.timers.size, 0);
  }
  for (const url of ["https://evil.example/macros/echo?x=y", "http://script.googleusercontent.com/macros/echo?x=y",
    "https://sub.script.googleusercontent.com/macros/echo?x=y", "https://script.googleusercontent.com/macros/other?x=y",
    "https://script.googleusercontent.com/macros/echo", redirectUrl + "#fragment",
    "https://user:secret@script.googleusercontent.com/macros/echo?x=y", PHOTO_UPLOAD_ENDPOINT + "?other=1", ""]) {
    const n = network({ respond: () => ({ url, text() { assert.fail("foreign body read"); } }) });
    const upload = createSchoolPhotoUpload({ environment: n.environment });
    await upload.start([file()], "fixture-code");
    assert.equal(upload.getModel().rows[0].state, "failed", url);
    assert.equal(n.requests.length, 1); assert.equal(n.timers.size, 0);
  }
});
test("fetch rejects unreadable HTTP, malformed JSON, nonce, method and schema without retries", async () => {
  const cases = [
    () => ({ ok: false }), () => ({ type: "opaque" }), () => ({ type: "opaqueredirect" }),
    () => ({ text: async () => "not JSON" }), () => ({ text: async () => " ".repeat(65537) }),
    () => ({ text: async () => "null" }), () => ({ text: async () => "[]" }),
    ...[reply => ({ ...reply, id: "wrong" }), reply => ({ ...reply, method: "uploadChunk" }),
      reply => ({ ...reply, ok: "true" }), reply => ({ ...reply, result: [] }),
      reply => ({ ...reply, result: null }), reply => ({ ...reply, error: "both variants" }),
      reply => ({ id: reply.id, method: reply.method, ok: false, error: "" }),
      reply => ({ id: reply.id, method: reply.method, ok: false, error: "x".repeat(401) }),
      reply => ({ id: reply.id, method: reply.method, ok: false, error: 1 })]
      .map(change => reply => ({ text: async () => JSON.stringify(change(reply)) }))
  ];
  for (const respond of cases) {
    const n = network({ respond }), upload = createSchoolPhotoUpload({ environment: n.environment });
    await upload.start([file(), file(2)], "fixture-code");
    assert.equal(upload.getModel().rows[0].state, "failed"); assert.equal(upload.getModel().rows[1].state, "queued");
    assert.equal(n.requests.length, 1); assert.equal(n.timers.size, 0);
    assert.ok(n.requests[0].options.signal.aborted);
  }
});
test("fetch allowlists incorrect-code message without reflecting arbitrary service text", async () => {
  for (const error of ["上傳碼不正確，請向收相人確認。", "untrusted fixture-code <script>"]) {
    const n = network({ respond: reply => ({ text: async () => JSON.stringify({ id: reply.id, method: reply.method, ok: false, error }) }) });
    const upload = createSchoolPhotoUpload({ environment: n.environment });
    await upload.start([file()], "fixture-code");
    const row = upload.getModel().rows[0]; assert.equal(row.state, "failed");
    if (error.startsWith("上傳碼")) assert.match(row.error, /上傳碼不正確/);
    assert.doesNotMatch(row.error, /fixture-code|untrusted|<script>/);
    assert.equal(n.requests.length, 1); assert.equal(n.timers.size, 0);
  }
});
test("fetch network rejection leaves manual retry with same key and no leaked request timer", async () => {
  const r = receiver(); let fail = true;
  const n = network({ send: async (method, args) => { if (fail) { fail = false; throw Error("network fixture-code"); } return r.send(method, args); } });
  const upload = createSchoolPhotoUpload({ environment: n.environment });
  await upload.start([file()], "fixture-code");
  assert.equal(n.requests.length, 1); assert.equal(n.timers.size, 0);
  await upload.retry("fixture-code");
  assert.deepEqual(n.requests[0].request.args, n.requests[1].request.args);
  assert.equal(upload.getModel().rows[0].state, "saved"); assert.equal(n.timers.size, 0);
});
test("fetch timeout aborts and clears active request; late response cannot publish", async () => {
  let release; const models = [];
  const n = network({ respond: reply => new Promise(resolve => { release = () => resolve({ text: async () => JSON.stringify(reply) }); }) });
  const upload = createSchoolPhotoUpload({ environment: n.environment, onChange: model => models.push(model) });
  const run = upload.start([file()], "fixture-code"); await until(() => release);
  [...n.timers.values()][0](); await run;
  assert.equal(upload.getModel().rows[0].state, "failed"); assert.equal(n.timers.size, 0);
  assert.ok(n.requests[0].options.signal.aborted); assert.equal(n.requests.length, 1);
  const published = models.length; release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(models.length, published); assert.equal(upload.getModel().rows[0].state, "failed");
  upload.cancel(); assert.equal(n.timers.size, 0);
});
test("cancel aborts during fetch or body read and ignores stale completion", async () => {
  for (const boundary of ["fetch", "text"]) {
    let release; const models = [];
    const n = network({ respond: reply => boundary === "fetch"
      ? new Promise(resolve => { release = () => resolve({ text: async () => JSON.stringify(reply) }); })
      : { text: () => new Promise(resolve => { release = () => resolve(JSON.stringify(reply)); }) } });
    const upload = createSchoolPhotoUpload({ environment: n.environment, onChange: model => models.push(model) });
    const run = upload.start([file()], "fixture-code"); await until(() => release);
    upload.cancel(); await run;
    assert.ok(n.requests[0].options.signal.aborted); assert.equal(n.timers.size, 0);
    assert.equal(upload.getModel().rows.length, 0);
    const published = models.length; release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(models.length, published); assert.equal(n.requests.length, 1);
  }
});
test("source invalidation while fetch is pending cannot publish or send another request", async () => {
  let release, valid = true; const models = [];
  const n = network({ respond: reply => new Promise(resolve => { release = () => resolve({ text: async () => JSON.stringify(reply) }); }) });
  const upload = createSchoolPhotoUpload({ environment: n.environment, isCurrent: () => valid, onChange: model => models.push(model) });
  const run = upload.start([file()], "fixture-code"); await until(() => release);
  valid = false; const published = models.length; release(); await run;
  assert.equal(models.length, published); assert.equal(n.requests.length, 1); assert.equal(n.timers.size, 0);
});
