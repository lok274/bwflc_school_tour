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
function dom() {
  const elements = [], listeners = new Map(); let timer, submit;
  const document = { createElement(tag) { const node = { tag, children: [], append(child) { this.children.push(child); }, remove() { this.removed = true; }, submit() { submit(JSON.parse(this.children[0].value)); } }; elements.push(node); return node; }, body: { append() {} } };
  const window = { addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); },
    setTimeout(fn, ms) { assert.equal(ms, 120000); timer = fn; return 1; }, clearTimeout() { timer = null; } };
  return { environment: { ...environment, document, window }, elements, listeners, timer: () => timer,
    setSubmit: fn => { submit = fn; }, reply: (data, origin = "https://script.googleusercontent.com") => listeners.get("message")?.({ origin, data }) };
}
test("hidden form RPC rejects spoof origins/nonces/methods/schema and cleans secrets on timeout", async () => {
  const d = dom(); let request;
  d.setSubmit(value => { request = value; });
  const upload = createSchoolPhotoUpload({ environment: d.environment });
  const run = upload.start([file()], "fixture-code");
  while (!request) await new Promise(resolve => setImmediate(resolve));
  const reply = { id: request.id, method: request.method, ok: true, result: ticket(request.args[1]) };
  d.reply(reply, "https://evil.example"); d.reply({ ...reply, id: "wrong" }); d.reply({ ...reply, method: "uploadChunk" }); d.reply({ ...reply, result: [] });
  assert.ok(d.listeners.has("message")); assert.equal(d.elements.find(node => node.tag === "form").action, PHOTO_UPLOAD_ENDPOINT);
  d.timer()(); await run;
  assert.equal(upload.getModel().rows[0].state, "failed"); assert.equal(d.listeners.size, 0);
  assert.ok(d.elements.filter(node => node.tag !== "input").every(node => node.removed));
  assert.equal(d.elements.find(node => node.tag === "input").value, "");
});
test("cancel cleans active form, iframe, timer and listener", async () => {
  const d = dom(); let request; d.setSubmit(value => { request = value; });
  const upload = createSchoolPhotoUpload({ environment: d.environment }); const run = upload.start([file()], "fixture-code");
  while (!request) await new Promise(resolve => setImmediate(resolve));
  upload.cancel(); await run;
  assert.equal(d.listeners.size, 0); assert.equal(d.timer(), null); assert.equal(upload.getModel().rows.length, 0);
});
