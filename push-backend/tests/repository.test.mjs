import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { repository, subscriber } from "./helpers.mjs";
import { validateSubscription, sha256 } from "../src/security.js";
import { MAX_ATTEMPTS, RETENTION_MS } from "../src/repository.js";

const announcement = { title: "老師公告", body: "請查看行程。", route: "itinerary" };
async function registration(repo, now, suffix) { const f = subscriber(suffix); const sub = await validateSubscription({ subscription: f.subscription, managementToken: f.managementToken }, now); repo.register(sub, "key", now); return sub; }
async function job(repo, now, id = crypto.randomUUID()) { return repo.createMessage(announcement, id, await sha256(JSON.stringify(announcement)), now); }

test("owner isolation, response-loss retries and delete-before-late-POST tombstones", async () => {
  const { repo, db } = repository();
  try {
    const sub = await registration(repo, 1000);
    assert.equal(repo.register(sub, "key", 1000).id, sub.id);
    assert.throws(() => repo.register({ ...sub, ownerHash: "another" }, "key", 1000), { status: 409 });
    assert.throws(() => repo.remove(sub.id, "another", 1001), { status: 401 });
    repo.remove(sub.id, sub.ownerHash, 1001); repo.remove(sub.id, sub.ownerHash, 1002);
    assert.throws(() => repo.register(sub, "key", 1003), { code: "subscription_cancelled" });
    const notArrived = await validateSubscription({ subscription: subscriber("late").subscription, managementToken: subscriber().managementToken }, 1000);
    repo.remove(notArrived.id, notArrived.ownerHash, 1000);
    assert.throws(() => repo.register(notArrived, "key", 1001), { code: "subscription_cancelled" });
    const data = JSON.stringify(repo.rows("SELECT * FROM tombstones")); assert.equal(data.includes(sub.endpoint), false); assert.equal(data.includes(sub.auth), false);
  } finally { db.close(); }
});
test("idempotent send, partial retry, stale lease and deletion never resend accepted recipient", async () => {
  const { repo, db } = repository();
  try {
    const a = await registration(repo, 1000, "a"); const b = await registration(repo, 1000, "b");
    const key = crypto.randomUUID(); const created = await job(repo, 1000, key);
    assert.equal((await job(repo, 1001, key)).jobId, created.jobId); assert.equal(repo.rows("SELECT * FROM messages").length, 1);
    assert.throws(() => repo.createMessage({ ...announcement, body: "different" }, key, "different", 1002), { status: 409 });
    const deliveries = repo.claim(1000); assert.equal(deliveries.length, 2);
    repo.finish(deliveries.find((d) => d.subscriptionId === a.id), { outcome: "accepted" }, 1001);
    repo.finish(deliveries.find((d) => d.subscriptionId === b.id), { outcome: "retry", code: "provider_unavailable" }, 1001);
    assert.equal(repo.status(created.jobId).accepted, 1); assert.equal(repo.claim(2000).length, 0);
    const retry = repo.claim(31001); assert.equal(retry.length, 1); assert.equal(retry[0].subscriptionId, b.id);
    // Simulate crash after network submission, then recover only the pending lease.
    assert.equal(repo.claim(50000).length, 0); const recovered = repo.claim(92000); assert.equal(recovered.length, 1);
    repo.remove(b.id, b.ownerHash, 92001);
    repo.finish(recovered[0], { outcome: "accepted" }, 92002);
    assert.equal(repo.status(created.jobId).accepted, 1); assert.equal(repo.status(created.jobId).expired, 1); assert.equal(repo.status(created.jobId).status, "partial");
  } finally { db.close(); }
});
test("gone subscription cleanup, bounded failures, manual retry and retention expiry", async () => {
  const { repo, db } = repository();
  try {
    const sub = await registration(repo, 1000); const created = await job(repo, 1000);
    let now = 1000;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const [delivery] = repo.claim(now); assert.ok(delivery); repo.finish(delivery, { outcome: "retry", code: "network_error" }, now); now += 30000 * 2 ** (attempt - 1);
    }
    assert.equal(repo.status(created.jobId).failed, 1);
    assert.equal(repo.retry(created.jobId, now).pending, 1);
    const [again] = repo.claim(now); repo.finish(again, { outcome: "gone" }, now + 1);
    assert.equal(repo.one("SELECT id FROM subscriptions WHERE id = ?", sub.id), undefined);
    assert.equal(repo.status(created.jobId).expired, 1);
    repo.cleanup(1000 + 86400001); assert.throws(() => repo.retry(created.jobId, 1000 + 86400001), { code: "expired" });
    assert.equal(repo.messages(1000 + 86400001).length, 1); // Delivery deadline differs from history retention.
    repo.cleanup(1000 + RETENTION_MS + 1); assert.equal(repo.messages(1000 + RETENTION_MS + 1).length, 0);
  } finally { db.close(); }
});
test("SQLite restart retains jobs, ownership, public messages and per-device test privacy", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bwflc-push-db-test-")); const file = path.join(dir, "database.sqlite"); let db;
  try {
    let state = repository(file); db = state.db; const sub = await registration(state.repo, 1000); const created = await job(state.repo, 1000);
    state.repo.createMessage({ title: "測試", body: "測試", route: "home" }, "test-job", "hash", 1000, sub.id);
    assert.equal(state.repo.messages(1000).length, 1); db.close();
    state = repository(file); db = state.db;
    assert.equal(state.repo.authorizeOwner(sub.id, sub.ownerHash).id, sub.id); assert.equal(state.repo.status(created.jobId).pending, 1);
    assert.equal(state.repo.claim(1000).length, 2);
    state.repo.rate("test-rate", 1, 60000, 1000); assert.throws(() => state.repo.rate("test-rate", 1, 60000, 1001), { status: 429 });
  } finally { db?.close(); if (!dir.startsWith(path.join(os.tmpdir(), "bwflc-push-db-test-"))) throw new Error("Invalid cleanup path"); await rm(dir, { recursive: true, force: true }); }
});
test("old provider410 cannot delete same-millisecond renewed subscription or its new job", async () => {
  const { repo, db } = repository();
  try {
    const sub = await registration(repo, 1000); const old = await job(repo, 1000); const [attempt] = repo.claim(1000);
    repo.register(sub, "key", 1000); const renewed = repo.one("SELECT version FROM subscriptions WHERE id = ?", sub.id);
    assert.notEqual(renewed.version, attempt.subscription.version);
    const next = await job(repo, 1001); repo.finish(attempt, { outcome: "gone" }, 1002);
    assert.equal(repo.one("SELECT version FROM subscriptions WHERE id = ?", sub.id).version, renewed.version);
    assert.equal(repo.status(old.jobId).expired, 1); assert.equal(repo.status(next.jobId).pending, 1);
  } finally { db.close(); }
});
test("explicit rate expiry schedules cleanup; disabled mode ignores overdue delivery alarms", async () => {
  const { repo, db } = repository();
  try {
    await registration(repo, 1000); await job(repo, 1000);
    assert.equal(repo.nextAlarm(1000, false), 1000 + 3600000);
    repo.rate("minute", 1, 60000, 1000); assert.equal(repo.nextAlarm(1000, false), 60000);
    repo.cleanup(60000); assert.equal(repo.rows("SELECT * FROM rate_limits").length, 0);
    assert.equal(repo.nextAlarm(60000, false), 60000 + 3600000);
  } finally { db.close(); }
});
