import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAdminController, validateDraft, validateJob } from "../push-backend/public/admin.js";

const CONTROL_IDS = [
  "session-form", "admin-token", "use-token", "clear-session", "session-status", "draft-form",
  "message-title", "message-body", "message-route", "preview-message", "preview-section", "preview-title",
  "preview-body", "preview-route", "confirm-public", "send-message", "operation-status", "job-counts",
  "refresh-status", "retry-failed", "new-draft", "count-total", "count-accepted", "count-pending", "count-failed", "count-expired"
];
const PRIVATE_TOKEN = "test-teacher-token-not-a-real-credential";
const UUID = "12345678-1234-4123-8123-123456789abc";

class Control {
  value = "";
  textContent = "";
  checked = false;
  disabled = false;
  hidden = false;
  focused = false;
  listeners = new Map();
  set innerHTML(_) { throw new Error("Dynamic HTML must not be used for announcements"); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type) {
    for (const callback of this.listeners.get(type) ?? []) callback({ preventDefault() {} });
  }
  focus() { this.focused = true; }
}

function job(overrides = {}) {
  return { jobId: "job-1", messageId: "message-1", status: "complete", total: 2, accepted: 2,
    pending: 0, failed: 0, expired: 0, createdAt: 1700000000000, updatedAt: 1700000000100, ...overrides };
}

function response(value = job(), status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function harness({ replies = [() => response()], maxPolls = 10 } = {}) {
  const elements = Object.fromEntries(CONTROL_IDS.map(id => [id, new Control()]));
  const calls = [];
  const timers = new Map();
  let nextTimer = 0;
  let uuidCount = 0;
  const h = { elements, calls, timers, confirmResult: false, confirmations: 0 };
  const environment = {
    AbortController,
    crypto: { randomUUID: () => { uuidCount += 1; return UUID; } },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    confirm() { h.confirmations += 1; return h.confirmResult; }
  };
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(environment, name, { get() { throw new Error("Credentials must remain in memory"); } });
  }
  h.controller = createAdminController({
    document: { getElementById: id => elements[id] }, environment, maxPolls,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return await (replies[calls.length - 1] ?? replies.at(-1))(url, options);
    }
  });
  h.authorize = () => {
    elements["admin-token"].value = PRIVATE_TOKEN;
    elements["session-form"].emit("submit");
  };
  h.preview = ({ title = "出發提醒", body = "請留意 App 的最新公告。", route = "itinerary" } = {}) => {
    elements["message-title"].value = title;
    elements["message-body"].value = body;
    elements["message-route"].value = route;
    elements["draft-form"].emit("submit");
  };
  h.confirm = () => { elements["confirm-public"].checked = true; elements["confirm-public"].emit("change"); };
  h.send = () => elements["send-message"].emit("click");
  h.uuidCount = () => uuidCount;
  h.poll = async () => {
    const pending = [...timers.entries()].find(([, timer]) => timer.delay >= 2000 && timer.delay !== 15000);
    assert.ok(pending, "an automatic status update is scheduled");
    timers.delete(pending[0]);
    pending[1].callback();
    await flush();
  };
  return h;
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test("admin validates Unicode character limits and only existing App routes", () => {
  assert.equal(validateDraft({ title: "😀".repeat(80), body: "中".repeat(600), route: "home" }).title.length, 160);
  assert.throws(() => validateDraft({ title: "😀".repeat(81), body: "公告", route: "home" }));
  assert.throws(() => validateDraft({ title: "公告", body: "中".repeat(601), route: "home" }));
  assert.throws(() => validateDraft({ title: "公告\n第二行", body: "公告", route: "home" }));
  for (const route of ["https://example.org/", "//example.org", "__proto__", "attraction/unknown", "device-test", "prepare"]) {
    assert.throws(() => validateDraft({ title: "公告", body: "公告", route }));
  }
  assert.equal(validateDraft({ title: " 公告 ", body: " 第一行\n第二行 ", route: "attraction/future-school" }).body, "第一行\n第二行");
});

test("admin requires preview, confirmation and a credential before a send", async () => {
  const h = harness();
  h.send();
  h.preview();
  h.send();
  h.confirm();
  h.send();
  assert.equal(h.calls.length, 0);
  h.authorize();
  assert.equal(h.elements["send-message"].disabled, false);
  h.send();
  h.send();
  assert.equal(h.calls.length, 1, "a duplicate click is suppressed while the request is pending");
  await flush();
  assert.equal(h.calls[0].url, "/v1/admin/messages");
  assert.equal(h.calls[0].options.headers.Authorization, `Bearer ${PRIVATE_TOKEN}`);
  assert.equal(h.calls[0].options.headers["Idempotency-Key"], UUID);
  assert.equal(h.calls[0].options.credentials, "omit");
  assert.equal(h.calls[0].options.mode, "same-origin");
  assert.equal(h.calls[0].options.redirect, "error");
  assert.equal(h.calls[0].options.cache, "no-store");
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { title: "出發提醒", body: "請留意 App 的最新公告。", route: "itinerary" });
  assert.match(h.elements["operation-status"].textContent, /推送服務已接受/u);
  assert.equal(h.elements["count-accepted"].textContent, "2");
  assert.equal(h.elements["message-title"].disabled, true);
});

test("announcement preview uses textContent and changes invalidate its confirmation", () => {
  const h = harness();
  const title = '<img src=x onerror="alert(1)">';
  const body = "<script>malicious()</script>\n文字";
  h.authorize();
  h.preview({ title, body, route: "attraction/sun-yat-sen" });
  assert.equal(h.elements["preview-title"].textContent, title);
  assert.equal(h.elements["preview-body"].textContent, body);
  assert.equal(h.elements["preview-route"].textContent, "孫中山故居紀念館");
  h.confirm();
  h.elements["message-body"].value = "改了內容";
  h.elements["message-body"].emit("input");
  h.send();
  assert.equal(h.calls.length, 0);
  assert.equal(h.elements["preview-section"].hidden, true);
  assert.equal(h.elements["confirm-public"].checked, false);
});

test("programmatic changes cannot send contents different from the preview", () => {
  const h = harness();
  h.authorize();
  h.preview();
  h.confirm();
  h.elements["message-body"].value = "尚未確認的內容";
  h.send();
  assert.equal(h.calls.length, 0);
  assert.equal(h.elements["preview-section"].hidden, true);
});

test("response loss retries the exact request with its existing UUID", async () => {
  const h = harness({ replies: [() => { throw new Error("network lost"); }, () => response()] });
  h.authorize();
  h.preview();
  h.confirm();
  h.send();
  await flush();
  assert.equal(h.controller.getSnapshot().uncertain, true);
  assert.equal(h.elements["message-body"].disabled, true);
  assert.match(h.elements["operation-status"].textContent, /可能已排程/u);
  h.elements["refresh-status"].emit("click");
  await flush();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].options.body, h.calls[1].options.body);
  assert.equal(h.calls[0].options.headers["Idempotency-Key"], h.calls[1].options.headers["Idempotency-Key"]);
  assert.equal(h.uuidCount(), 1);
  assert.equal(h.controller.getSnapshot().uncertain, false);
});

test("invalid server replies preserve the attempt and cannot become success", async () => {
  const h = harness({ replies: [() => response({ ...job(), accepted: 99 }), () => response()] });
  h.authorize(); h.preview(); h.confirm(); h.send();
  await flush();
  assert.equal(h.controller.getSnapshot().job, null);
  assert.equal(h.controller.getSnapshot().uncertain, true);
  h.elements["refresh-status"].emit("click");
  await flush();
  assert.equal(h.calls[1].options.headers["Idempotency-Key"], UUID);
  assert.equal(h.controller.getSnapshot().job.accepted, 2);
  assert.throws(() => validateJob({ ...job(), jobId: "../other-path" }));
  assert.throws(() => validateJob({ ...job(), jobId: true }));
  assert.throws(() => validateJob({ ...job(), messageId: 12345 }));
});

test("401 clears the credential without exposing a server error or losing the attempt", async () => {
  const h = harness({ replies: [() => response({ error: { message: PRIVATE_TOKEN } }, 401), () => response()] });
  h.authorize(); h.preview(); h.confirm(); h.send();
  await flush();
  assert.equal(h.controller.getSnapshot().hasCredential, false);
  assert.equal(h.elements["admin-token"].value, "");
  for (const element of Object.values(h.elements)) assert.ok(!element.textContent.includes(PRIVATE_TOKEN));
  assert.ok(!JSON.stringify(h.controller.getSnapshot()).includes(PRIVATE_TOKEN));
  h.authorize();
  h.elements["refresh-status"].emit("click");
  await flush();
  assert.equal(h.calls[1].options.headers["Idempotency-Key"], UUID);
});

test("clearing the session aborts local requests and ignores their late replies", async () => {
  let resolveRequest;
  const h = harness({ replies: [() => new Promise(resolve => { resolveRequest = resolve; }), () => response()] });
  h.authorize(); h.preview(); h.confirm(); h.send();
  assert.equal(h.controller.getSnapshot().busy, true);
  h.elements["clear-session"].emit("click");
  assert.equal(h.calls[0].options.signal.aborted, true);
  resolveRequest(response());
  await flush();
  assert.equal(h.controller.getSnapshot().hasCredential, false);
  assert.equal(h.controller.getSnapshot().job, null);
  assert.equal(h.controller.getSnapshot().busy, false);
  assert.match(h.elements["operation-status"].textContent, /不會取消發送/u);
  h.authorize();
  h.elements["refresh-status"].emit("click");
  await flush();
  assert.equal(h.calls[1].options.headers["Idempotency-Key"], UUID);
});

test("only known failed recipients can be retried and status queries do not repost", async () => {
  const partial = job({ status: "partial", accepted: 1, failed: 1 });
  const h = harness({ replies: [() => response(partial), () => response(partial), () => response()] });
  h.authorize(); h.preview(); h.confirm(); h.send();
  await flush();
  assert.equal(h.elements["retry-failed"].disabled, false);
  h.elements["refresh-status"].emit("click");
  await flush();
  assert.equal(h.calls[1].url, "/v1/admin/messages/job-1");
  assert.equal(h.calls[1].options.method, "GET");
  h.elements["retry-failed"].emit("click");
  await flush();
  assert.equal(h.calls[2].url, "/v1/admin/messages/job-1/retry");
  assert.equal(h.calls[2].options.method, "POST");
  assert.equal(h.calls[2].options.body, undefined);
  assert.equal(h.elements["retry-failed"].disabled, true);
});

test("status responses cannot replace an existing job with another message", async () => {
  const h = harness({ replies: [() => response(), () => response(job({ messageId: "unrelated-message" }))] });
  h.authorize(); h.preview(); h.confirm(); h.send();
  await flush();
  h.elements["refresh-status"].emit("click");
  await flush();
  assert.equal(h.controller.getSnapshot().job.messageId, "message-1");
  assert.match(h.elements["operation-status"].textContent, /上次記錄/u);
});

test("dispose clears the in-memory credential and leaves no active UI handlers", async () => {
  const h = harness();
  h.authorize(); h.preview(); h.confirm();
  h.controller.dispose();
  assert.equal(h.controller.getSnapshot().hasCredential, false);
  assert.equal(h.elements["admin-token"].value, "");
  h.send();
  await flush();
  assert.equal(h.calls.length, 0);
  for (const element of Object.values(h.elements)) {
    for (const listeners of element.listeners.values()) assert.equal(listeners.size, 0);
  }
});

test("automatic status updates stop after a finite backoff and can be resumed manually", async () => {
  const queued = job({ status: "queued", accepted: 0, pending: 2 });
  const h = harness({ replies: [() => response(queued)], maxPolls: 2 });
  h.authorize(); h.preview(); h.confirm(); h.send();
  await flush();
  await h.poll();
  await h.poll();
  assert.equal(h.calls.length, 3);
  assert.equal(h.timers.size, 0);
  assert.match(h.elements["operation-status"].textContent, /暫停自動更新/u);
  h.elements["refresh-status"].emit("click");
  await flush();
  assert.equal(h.calls.length, 4);
  assert.equal(h.timers.size, 1);
  h.controller.dispose();
  assert.equal(h.timers.size, 0);
});

test("an uncertain previous attempt needs an explicit decision before a new draft", async () => {
  const h = harness({ replies: [() => { throw new Error("offline"); }] });
  h.authorize(); h.preview(); h.confirm(); h.send();
  await flush();
  h.elements["new-draft"].emit("click");
  assert.equal(h.confirmations, 1);
  assert.equal(h.controller.getSnapshot().hasAttempt, true);
  h.confirmResult = true;
  h.elements["new-draft"].emit("click");
  assert.equal(h.controller.getSnapshot().hasAttempt, false);
  assert.equal(h.controller.getSnapshot().hasPreview, false);
  assert.equal(h.elements["confirm-public"].checked, false);
  assert.equal(h.elements["message-title"].focused, true);
  assert.equal(h.calls.length, 1);
});

test("the admin document uses local assets, public-data guidance and matching controls", async () => {
  const html = await readFile(new URL("../push-backend/public/admin.html", import.meta.url), "utf8");
  for (const id of CONTROL_IDS) assert.ok(html.includes(`id="${id}"`), `missing control ${id}`);
  assert.match(html, /公告會在 App 公開顯示/u);
  assert.match(html, /不代表每部手機已收到或已閱讀/u);
  assert.match(html, /type="password" autocomplete="off"/u);
  assert.match(html, /connect-src 'self'/u);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|\son\w+\s*=|https?:\/\//u);
});
